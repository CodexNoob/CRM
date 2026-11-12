import { and, asc, desc, eq, gt, ilike, inArray, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "@/db";
import {
  activities,
  clients,
  conversationReads,
  conversations,
  documents,
  engagements,
  messageAttachments,
  messages,
  taxReturns,
  users,
  type ConversationCategory,
  type ConversationStatus,
} from "@/db/schema";
import type { Actor } from "@/lib/auth/actor";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { isUuid, messageBodySchema, parseInput } from "@/lib/validation";
import { z } from "zod";
import { assertActiveStaffUser, assertClientAccess, ensureAssignment, inFirm, requirePermission, requireStaff, visibleClientsCondition } from "./access";
import { recordAudit } from "./audit";
import { notifyClientUsers } from "./client-notifications";
import { uploadDocument } from "./documents";
import { assertPortalClientAccess, resolvePortalClient } from "./portal-access";
import { logActivity, nextNumber, type CounterKind } from "./timeline";

/**
 * Secure conversations between the firm and its clients. One client has many
 * conversations; each has a subject, category, status, priority and an optional assignee.
 *
 * Privacy rules (enforced in SQL, never only in the UI):
 *  - Internal notes (`is_internal`) are staff-only and are excluded from EVERY portal query.
 *  - Portal users only ever reach conversations of clients resolved for them on the server
 *    (portal_client_access); a client id from the browser is only a hint.
 *  - Staff only reach conversations of clients they can access (firm + assignment).
 * Message bodies are never emailed or logged; the audit trail records only that a message was sent.
 */

export const CONVERSATION_CATEGORIES = conversations.category.enumValues;
export const CONVERSATION_STATUSES = conversations.status.enumValues;
const CLOSED: ConversationStatus[] = ["resolved", "closed"];
const INBOX: ConversationStatus[] = ["open", "in_progress", "waiting_for_staff"];

const author = alias(users, "msg_author");
const assignee = alias(users, "conv_assignee");

/* ───────── Validation ───────── */

const optionalUuid = (label: string) => z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.uuid(`Choose a valid ${label}.`).optional());

const newConversationSchema = z.object({
  subject: z.string({ error: "Add a subject." }).trim().min(1, "Add a subject.").max(200, "Keep the subject under 200 characters."),
  category: z.enum(CONVERSATION_CATEGORIES, { error: "Choose a category." }).default("general_inquiry"),
  priority: z.enum(["low", "normal", "high", "urgent"], { error: "Choose a priority." }).default("normal"),
  engagementId: optionalUuid("engagement"),
  taxReturnId: optionalUuid("tax return"),
  assignedStaffId: optionalUuid("staff member"),
  body: messageBodySchema,
});

export interface AttachmentInput {
  fileName: string;
  data: Buffer;
}

/* ───────── Access helpers ───────── */

type ConversationRow = typeof conversations.$inferSelect;

/** Loads a conversation for a staff member who may see it (NotFound otherwise). */
async function loadForStaff(db: Db, actor: Actor, conversationId: string): Promise<ConversationRow> {
  requireStaff(actor);
  requirePermission(actor, "messages", "view");
  if (!isUuid(conversationId)) throw new NotFoundError();
  const [c] = await db.select().from(conversations).where(and(eq(conversations.id, conversationId), inFirm(conversations.firmId, actor))).limit(1);
  if (!c) throw new NotFoundError();
  await assertClientAccess(db, actor, c.clientId);
  return c;
}

/** Loads a conversation for a portal user — only if it belongs to a client they may access. */
async function loadForPortal(db: Db, actor: Actor, clientId: string, conversationId: string): Promise<ConversationRow> {
  if (actor.role !== "client") throw new ForbiddenError();
  await assertPortalClientAccess(db, actor, clientId);
  if (!isUuid(conversationId)) throw new NotFoundError();
  const [c] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.clientId, clientId), inFirm(conversations.firmId, actor)))
    .limit(1);
  if (!c) throw new NotFoundError();
  return c;
}

async function validateLinks(db: Db, actor: Actor, clientId: string, d: { engagementId?: string; taxReturnId?: string }) {
  if (d.engagementId) {
    const [e] = await db.select({ clientId: engagements.clientId }).from(engagements).where(and(eq(engagements.id, d.engagementId), inFirm(engagements.firmId, actor)));
    if (!e || e.clientId !== clientId) throw new ValidationError({ engagementId: ["That engagement belongs to a different client."] });
  }
  if (d.taxReturnId) {
    const [r] = await db.select({ clientId: taxReturns.clientId }).from(taxReturns).where(and(eq(taxReturns.id, d.taxReturnId), inFirm(taxReturns.firmId, actor)));
    if (!r || r.clientId !== clientId) throw new ValidationError({ taxReturnId: ["That tax return belongs to a different client."] });
  }
}

async function validateAssignee(db: Db, actor: Actor, clientId: string, userId: string) {
  await assertActiveStaffUser(db, actor, userId, "assignedStaffId");
  // The assignee must be able to open the client's records.
  await ensureAssignment(db, actor.firmId, clientId, userId);
}

async function markRead(db: Db, actor: Actor, conversationId: string, at = new Date()) {
  await db
    .insert(conversationReads)
    .values({ firmId: actor.firmId, conversationId, userId: actor.userId, lastReadAt: at })
    .onConflictDoUpdate({ target: [conversationReads.conversationId, conversationReads.userId], set: { lastReadAt: at } });
}

/** Who on staff should hear about a client message: the assignee, else the client's account manager. */
async function staffRecipient(db: Db, c: ConversationRow): Promise<string | null> {
  if (c.assignedStaffId) return c.assignedStaffId;
  const [row] = await db.select({ id: clients.accountManagerId }).from(clients).where(and(eq(clients.id, c.clientId), eq(clients.firmId, c.firmId)));
  return row?.id ?? null;
}

/* ───────── Writing ───────── */

async function insertMessage(
  db: Db,
  actor: Actor,
  c: ConversationRow,
  m: { body: string; internal?: boolean; attachments?: AttachmentInput[] },
): Promise<typeof messages.$inferSelect> {
  const fromClient = actor.role === "client";
  const internal = !fromClient && !!m.internal;
  const now = new Date();
  const [msg] = await db
    .insert(messages)
    .values({
      firmId: actor.firmId,
      clientId: c.clientId,
      conversationId: c.id,
      authorId: actor.userId,
      fromClient,
      body: m.body,
      isInternal: internal,
      messageType: internal ? "internal_note" : "message",
      createdAt: now,
    })
    .returning();
  for (const file of m.attachments ?? []) {
    // The bytes are stored once, as a client document; the message only links to it.
    const doc = await uploadDocument(db, actor, { clientId: c.clientId, engagementId: c.engagementId ?? undefined, visibleToClient: !internal, fileName: file.fileName, data: file.data });
    await db
      .update(documents)
      .set({ visibility: fromClient ? "client_visible" : internal ? "internal_only" : "shared_with_client", visibleToClient: !internal })
      .where(and(eq(documents.id, doc.id), inFirm(documents.firmId, actor)));
    await db.insert(messageAttachments).values({ firmId: actor.firmId, messageId: msg!.id, documentId: doc.id });
  }
  // The author has read everything up to their own message.
  await markRead(db, actor, c.id, now);
  if (!internal) await db.update(conversations).set({ lastMessageAt: now, updatedAt: now }).where(eq(conversations.id, c.id));
  await recordAudit(db, { firmId: actor.firmId, actorUserId: actor.userId, action: internal ? "message.internal_note" : "message.send", entityType: "client", entityId: c.clientId, metadata: { conversationId: c.id } });

  if (fromClient) {
    const notifyUserId = await staffRecipient(db, c);
    await logActivity(db, actor, {
      entityType: "client",
      entityId: c.clientId,
      clientId: c.clientId,
      type: "system",
      body: `New client message: ${c.subject}`,
      // Read by staff notifications (services/workspace.ts) when a recipient is known.
      metadata: { kind: "message", conversationId: c.id, notifyUserId },
    });
  } else if (!internal) {
    await notifyClientUsers(db, actor.firmId, c.clientId, { type: "message", title: `New message: ${c.subject}`, href: `/portal/messages/${c.id}`, dedupeKey: `msg:${msg!.id}` });
  }
  return msg!;
}

async function setStatusInternal(db: Db, actor: Actor, c: ConversationRow, status: ConversationStatus, note?: string) {
  if (c.status === status) return;
  await db.update(conversations).set({ status, updatedAt: new Date() }).where(eq(conversations.id, c.id));
  if (actor.role !== "client") {
    await logActivity(db, actor, { entityType: "client", entityId: c.clientId, clientId: c.clientId, type: "status_change", body: note ?? null, metadata: { field: "conversation", conversationId: c.id, from: c.status, to: status } });
  }
}

/** Staff starts a conversation with a client (first message is client-visible). */
export async function createConversation(db: Db, actor: Actor, clientId: string, input: unknown, attachments: AttachmentInput[] = []): Promise<ConversationRow> {
  requirePermission(actor, "messages", "create");
  await assertClientAccess(db, actor, clientId);
  const d = parseInput(newConversationSchema, input);
  await validateLinks(db, actor, clientId, d);
  if (d.assignedStaffId && d.assignedStaffId !== actor.userId) requirePermission(actor, "messages", "assign");
  return db.transaction(async (txRaw) => {
    const t = txRaw as unknown as Db;
    if (d.assignedStaffId) await validateAssignee(t, actor, clientId, d.assignedStaffId);
    const [c] = await t
      .insert(conversations)
      .values({
        firmId: actor.firmId,
        clientId,
        conversationNumber: await nextNumber(t, actor.firmId, "conversation" as CounterKind),
        subject: d.subject,
        category: d.category,
        priority: d.priority,
        engagementId: d.engagementId ?? null,
        taxReturnId: d.taxReturnId ?? null,
        assignedStaffId: d.assignedStaffId ?? null,
        createdById: actor.userId,
        status: "waiting_for_client",
      })
      .returning();
    await insertMessage(t, actor, c!, { body: d.body, attachments });
    if (d.assignedStaffId) await recordAssignment(t, actor, c!, null, d.assignedStaffId);
    return c!;
  });
}

/** A portal user starts a conversation for the client resolved for them. */
export async function createPortalConversation(db: Db, actor: Actor, clientId: string, input: unknown, attachments: AttachmentInput[] = []): Promise<ConversationRow> {
  if (actor.role !== "client") throw new ForbiddenError();
  await assertPortalClientAccess(db, actor, clientId);
  const d = parseInput(newConversationSchema.pick({ subject: true, category: true, body: true }), input);
  return db.transaction(async (txRaw) => {
    const t = txRaw as unknown as Db;
    const [c] = await t
      .insert(conversations)
      .values({
        firmId: actor.firmId,
        clientId,
        conversationNumber: await nextNumber(t, actor.firmId, "conversation" as CounterKind),
        subject: d.subject,
        category: d.category,
        createdById: actor.userId,
        status: "waiting_for_staff",
      })
      .returning();
    await insertMessage(t, actor, c!, { body: d.body, attachments });
    return c!;
  });
}

/** Staff reply (client-visible) or internal note. A staff reply puts the conversation on the client. */
export async function replyAsStaff(db: Db, actor: Actor, conversationId: string, input: { body: unknown; internal?: boolean }, attachments: AttachmentInput[] = []) {
  const c = await loadForStaff(db, actor, conversationId);
  requirePermission(actor, "messages", input.internal ? "internal_note" : "reply");
  const body = parseInput(messageBodySchema, input.body);
  return db.transaction(async (txRaw) => {
    const t = txRaw as unknown as Db;
    const msg = await insertMessage(t, actor, c, { body, internal: input.internal, attachments });
    // Replying to a resolved/closed conversation reopens it; internal notes never change status.
    if (!input.internal) await setStatusInternal(t, actor, c, "waiting_for_client");
    return msg;
  });
}

/** Client reply. Closed conversations can't be reopened by the client — they start a new one. */
export async function replyAsClient(db: Db, actor: Actor, clientId: string, conversationId: string, body: unknown, attachments: AttachmentInput[] = []) {
  const c = await loadForPortal(db, actor, clientId, conversationId);
  if (c.status === "closed") throw new ValidationError({ body: ["This conversation is closed. Start a new conversation instead."] });
  const text = parseInput(messageBodySchema, body);
  return db.transaction(async (txRaw) => {
    const t = txRaw as unknown as Db;
    const msg = await insertMessage(t, actor, c, { body: text, attachments });
    await setStatusInternal(t, actor, c, "waiting_for_staff");
    return msg;
  });
}

export async function setConversationStatus(db: Db, actor: Actor, conversationId: string, status: ConversationStatus): Promise<void> {
  const c = await loadForStaff(db, actor, conversationId);
  if (!CONVERSATION_STATUSES.includes(status)) throw new ValidationError({ status: ["Choose a status."] });
  requirePermission(actor, "messages", CLOSED.includes(status) ? "close" : "reply");
  await setStatusInternal(db, actor, c, status);
  await recordAudit(db, { firmId: actor.firmId, actorUserId: actor.userId, action: "conversation.status", entityType: "client", entityId: c.clientId, metadata: { conversationId: c.id, from: c.status, to: status } });
}

export async function updateConversationDetails(db: Db, actor: Actor, conversationId: string, input: { category?: unknown; priority?: unknown; subject?: unknown }): Promise<void> {
  const c = await loadForStaff(db, actor, conversationId);
  requirePermission(actor, "messages", "reply");
  const d = parseInput(newConversationSchema.pick({ subject: true, category: true, priority: true }).partial(), input);
  await db.update(conversations).set({ ...d, updatedAt: new Date() }).where(eq(conversations.id, c.id));
}

async function recordAssignment(db: Db, actor: Actor, c: ConversationRow, from: string | null, to: string | null) {
  await logActivity(db, actor, {
    entityType: "client",
    entityId: c.clientId,
    clientId: c.clientId,
    type: "assignment",
    // userId → read by staff notifications ("You were assigned to …").
    metadata: { field: "conversation", conversationId: c.id, from, to, userId: to, title: c.subject },
  });
  await recordAudit(db, { firmId: actor.firmId, actorUserId: actor.userId, action: "conversation.assign", entityType: "client", entityId: c.clientId, metadata: { conversationId: c.id, from, to } });
}

/** Assign / reassign / unassign (assign permission). Assignment history is kept on the timeline + audit log. */
export async function assignConversation(db: Db, actor: Actor, conversationId: string, assigneeId: string | null): Promise<void> {
  requirePermission(actor, "messages", "assign");
  const c = await loadForStaff(db, actor, conversationId);
  if (c.assignedStaffId === assigneeId) return;
  await db.transaction(async (txRaw) => {
    const t = txRaw as unknown as Db;
    if (assigneeId) await validateAssignee(t, actor, c.clientId, assigneeId);
    await t.update(conversations).set({ assignedStaffId: assigneeId, updatedAt: new Date() }).where(eq(conversations.id, c.id));
    await recordAssignment(t, actor, c, c.assignedStaffId, assigneeId);
  });
}

/** Assignment history of a conversation (from the timeline). */
export async function listAssignmentHistory(db: Db, actor: Actor, conversationId: string) {
  const c = await loadForStaff(db, actor, conversationId);
  const actorUser = alias(users, "assign_actor");
  const toUser = alias(users, "assign_to");
  return db
    .select({ at: activities.occurredAt, actorName: actorUser.name, toName: toUser.name, metadata: activities.metadata })
    .from(activities)
    .leftJoin(actorUser, eq(actorUser.id, activities.actorId))
    .leftJoin(toUser, sql`${toUser.id}::text = ${activities.metadata} ->> 'to'`)
    .where(and(eq(activities.firmId, actor.firmId), eq(activities.clientId, c.clientId), eq(activities.type, "assignment"), sql`${activities.metadata} ->> 'conversationId' = ${c.id}`))
    .orderBy(asc(activities.occurredAt));
}

/* ───────── Reading ───────── */

export interface ConversationMessage {
  id: string;
  body: string;
  fromClient: boolean;
  isInternal: boolean;
  authorName: string | null;
  createdAt: Date;
  mine: boolean;
  attachments: { id: string; fileName: string; sizeBytes: number }[];
}

async function messageRows(db: Db, actor: Actor, where: SQL): Promise<ConversationMessage[]> {
  const rows = await db
    .select({ id: messages.id, body: messages.body, fromClient: messages.fromClient, isInternal: messages.isInternal, authorName: author.name, authorId: messages.authorId, createdAt: messages.createdAt })
    .from(messages)
    .leftJoin(author, and(eq(author.id, messages.authorId), eq(author.firmId, messages.firmId)))
    .where(and(inFirm(messages.firmId, actor), where))
    .orderBy(asc(messages.createdAt))
    .limit(500);
  const ids = rows.map((r) => r.id);
  const files = ids.length
    ? await db
        .select({ messageId: messageAttachments.messageId, id: documents.id, fileName: documents.fileName, sizeBytes: documents.sizeBytes })
        .from(messageAttachments)
        .innerJoin(documents, and(eq(documents.id, messageAttachments.documentId), eq(documents.firmId, messageAttachments.firmId)))
        .where(and(inFirm(messageAttachments.firmId, actor), inArray(messageAttachments.messageId, ids), isNull(documents.deletedAt)))
    : [];
  return rows.map(({ authorId, ...r }) => ({ ...r, mine: authorId === actor.userId, attachments: files.filter((f) => f.messageId === r.id).map(({ messageId: _m, ...f }) => (void _m, f)) }));
}

export interface ConversationDetail {
  conversation: ConversationRow;
  clientName: string;
  assigneeName: string | null;
  engagementTitle: string | null;
  messages: ConversationMessage[];
}

/** Staff view of a conversation, including internal notes. Marks it read for this staff member. */
export async function getConversation(db: Db, actor: Actor, conversationId: string): Promise<ConversationDetail> {
  const c = await loadForStaff(db, actor, conversationId);
  const [names] = await db
    .select({ clientName: clients.displayName, assigneeName: assignee.name, engagementTitle: engagements.title })
    .from(conversations)
    .innerJoin(clients, eq(clients.id, conversations.clientId))
    .leftJoin(assignee, eq(assignee.id, conversations.assignedStaffId))
    .leftJoin(engagements, eq(engagements.id, conversations.engagementId))
    .where(eq(conversations.id, c.id));
  const list = await messageRows(db, actor, eq(messages.conversationId, c.id));
  await markRead(db, actor, c.id);
  return { conversation: c, clientName: names?.clientName ?? "", assigneeName: names?.assigneeName ?? null, engagementTitle: names?.engagementTitle ?? null, messages: list };
}

/** Portal view: internal notes are excluded in SQL. Marks it read for this portal user. */
export async function getPortalConversation(db: Db, actor: Actor, clientId: string, conversationId: string) {
  const c = await loadForPortal(db, actor, clientId, conversationId);
  const list = await messageRows(db, actor, and(eq(messages.conversationId, c.id), eq(messages.isInternal, false))!);
  await markRead(db, actor, c.id);
  return {
    conversation: { id: c.id, subject: c.subject, category: c.category, status: c.status, conversationNumber: c.conversationNumber, lastMessageAt: c.lastMessageAt, createdAt: c.createdAt },
    messages: list.map((m) => ({ ...m, isInternal: false as const })),
  };
}

export interface InboxRow {
  id: string;
  conversationNumber: number | null;
  subject: string;
  category: ConversationCategory;
  status: ConversationStatus;
  priority: ConversationRow["priority"];
  clientId: string;
  clientName: string;
  assignedStaffId: string | null;
  assigneeName: string | null;
  lastMessageAt: Date;
  /** Last client-visible message (never an internal note). */
  lastBody: string;
  lastFromClient: boolean;
  /** Back-compat alias of lastMessageAt. */
  lastAt: Date;
  unread: number;
}

export type InboxFolder = "inbox" | "sent" | "mine" | "unassigned" | "waiting_for_client" | "waiting_for_staff" | "resolved" | "closed" | "all";

export interface InboxFilters {
  folder?: InboxFolder;
  q?: string;
  clientId?: string;
  status?: ConversationStatus;
  category?: ConversationCategory;
  assigneeId?: string | "none";
}

/** Unread client-visible messages for `userId` in a conversation (not authored by them). */
function unreadSql(userId: string, opts: { includeInternal: boolean }) {
  // Explicitly qualified: in single-table selects Drizzle renders columns unqualified,
  // which inside this correlated subquery would bind to the subquery's own table.
  const convId = sql.raw(`"conversations"."id"`);
  const convFirm = sql.raw(`"conversations"."firm_id"`);
  return sql<number>`(select count(*)::int from ${messages} um
    where um.conversation_id = ${convId} and um.firm_id = ${convFirm}
      and (um.author_id is null or um.author_id <> ${userId})
      ${opts.includeInternal ? sql`` : sql`and um.is_internal = false`}
      and um.created_at > coalesce((select cr.last_read_at from ${conversationReads} cr where cr.conversation_id = ${convId} and cr.user_id = ${userId}), '-infinity'::timestamptz))`;
}

const lastVisible = (field: "body" | "from_client") =>
  sql.raw(`(select lm.${field} from messages lm where lm.conversation_id = "conversations"."id" and lm.is_internal = false order by lm.created_at desc limit 1)`);

function folderCondition(actor: Actor, folder: InboxFolder): SQL | undefined {
  switch (folder) {
    case "inbox":
      return inArray(conversations.status, INBOX);
    case "sent":
      return and(sql`${lastVisible("from_client")} = false`, ne(conversations.status, "closed"));
    case "mine":
      return and(eq(conversations.assignedStaffId, actor.userId), sql`${conversations.status} not in ('resolved','closed')`);
    case "unassigned":
      return and(isNull(conversations.assignedStaffId), sql`${conversations.status} not in ('resolved','closed')`);
    case "waiting_for_client":
    case "waiting_for_staff":
    case "resolved":
    case "closed":
      return eq(conversations.status, folder);
    default:
      return undefined;
  }
}

/** Staff inbox (conversations of clients the actor can access). */
export async function listInbox(db: Db, actor: Actor, f: InboxFilters = {}): Promise<InboxRow[]> {
  requireStaff(actor);
  requirePermission(actor, "messages", "view");
  const visible = visibleClientsCondition(db, actor);
  const q = f.q?.trim().slice(0, 100);
  const like = q ? `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%` : undefined;
  const rows = await db
    .select({
      id: conversations.id,
      conversationNumber: conversations.conversationNumber,
      subject: conversations.subject,
      category: conversations.category,
      status: conversations.status,
      priority: conversations.priority,
      clientId: conversations.clientId,
      clientName: clients.displayName,
      assignedStaffId: conversations.assignedStaffId,
      assigneeName: assignee.name,
      lastMessageAt: conversations.lastMessageAt,
      lastBody: sql<string | null>`${lastVisible("body")}`,
      lastFromClient: sql<boolean | null>`${lastVisible("from_client")}`,
      unread: unreadSql(actor.userId, { includeInternal: false }),
    })
    .from(conversations)
    .innerJoin(clients, eq(clients.id, conversations.clientId))
    .leftJoin(assignee, eq(assignee.id, conversations.assignedStaffId))
    .where(
      and(
        inFirm(conversations.firmId, actor),
        visible,
        folderCondition(actor, f.folder ?? "all"),
        f.clientId && isUuid(f.clientId) ? eq(conversations.clientId, f.clientId) : undefined,
        f.status && CONVERSATION_STATUSES.includes(f.status) ? eq(conversations.status, f.status) : undefined,
        f.category && CONVERSATION_CATEGORIES.includes(f.category) ? eq(conversations.category, f.category) : undefined,
        f.assigneeId === "none" ? isNull(conversations.assignedStaffId) : f.assigneeId && isUuid(f.assigneeId) ? eq(conversations.assignedStaffId, f.assigneeId) : undefined,
        like
          ? or(
              ilike(conversations.subject, like),
              ilike(clients.displayName, like),
              sql`exists (select 1 from ${messages} sm where sm.conversation_id = ${conversations.id} and sm.body ilike ${like})`,
            )
          : undefined,
      ),
    )
    .orderBy(desc(conversations.lastMessageAt))
    .limit(300);
  return rows.map((r) => ({ ...r, lastBody: r.lastBody ?? "", lastFromClient: !!r.lastFromClient, lastAt: r.lastMessageAt }));
}

/** Counts per folder for the inbox sidebar. */
export async function countInboxFolders(db: Db, actor: Actor): Promise<Record<InboxFolder, number> & { unread: number }> {
  requireStaff(actor);
  const visible = visibleClientsCondition(db, actor);
  const [r] = await db
    .select({
      inbox: sql<number>`count(*) filter (where ${conversations.status} in ('open','in_progress','waiting_for_staff'))::int`,
      sent: sql<number>`count(*) filter (where ${lastVisible("from_client")} = false and ${conversations.status} <> 'closed')::int`,
      mine: sql<number>`count(*) filter (where ${conversations.assignedStaffId} = ${actor.userId} and ${conversations.status} not in ('resolved','closed'))::int`,
      unassigned: sql<number>`count(*) filter (where ${conversations.assignedStaffId} is null and ${conversations.status} not in ('resolved','closed'))::int`,
      waiting_for_client: sql<number>`count(*) filter (where ${conversations.status} = 'waiting_for_client')::int`,
      waiting_for_staff: sql<number>`count(*) filter (where ${conversations.status} = 'waiting_for_staff')::int`,
      resolved: sql<number>`count(*) filter (where ${conversations.status} = 'resolved')::int`,
      closed: sql<number>`count(*) filter (where ${conversations.status} = 'closed')::int`,
      all: sql<number>`count(*)::int`,
      unread: sql<number>`coalesce(sum(${unreadSql(actor.userId, { includeInternal: false })}), 0)::int`,
    })
    .from(conversations)
    .innerJoin(clients, eq(clients.id, conversations.clientId))
    .where(and(inFirm(conversations.firmId, actor), visible));
  return r ?? { inbox: 0, sent: 0, mine: 0, unassigned: 0, waiting_for_client: 0, waiting_for_staff: 0, resolved: 0, closed: 0, all: 0, unread: 0 };
}

/** Conversations of one client (staff, e.g. the client's Messages tab). */
export async function listClientConversations(db: Db, actor: Actor, clientId: string): Promise<InboxRow[]> {
  await assertClientAccess(db, actor, clientId);
  return listInbox(db, actor, { clientId, folder: "all" });
}

export interface PortalConversationRow {
  id: string;
  conversationNumber: number | null;
  subject: string;
  category: ConversationCategory;
  status: ConversationStatus;
  lastMessageAt: Date;
  lastBody: string;
  lastFromClient: boolean;
  unread: number;
}

/** The portal user's conversations for one of their clients. Internal notes never counted or shown. */
export async function listPortalConversations(db: Db, actor: Actor, clientId: string): Promise<PortalConversationRow[]> {
  if (actor.role !== "client") throw new ForbiddenError();
  await assertPortalClientAccess(db, actor, clientId);
  const rows = await db
    .select({
      id: conversations.id,
      conversationNumber: conversations.conversationNumber,
      subject: conversations.subject,
      category: conversations.category,
      status: conversations.status,
      lastMessageAt: conversations.lastMessageAt,
      lastBody: sql<string | null>`${lastVisible("body")}`,
      lastFromClient: sql<boolean | null>`${lastVisible("from_client")}`,
      unread: unreadSql(actor.userId, { includeInternal: false }),
    })
    .from(conversations)
    .where(and(inFirm(conversations.firmId, actor), eq(conversations.clientId, clientId)))
    .orderBy(desc(conversations.lastMessageAt))
    .limit(200);
  return rows.map((r) => ({ ...r, lastBody: r.lastBody ?? "", lastFromClient: !!r.lastFromClient }));
}

/* ───────── Unread counts ───────── */

export async function countUnreadForStaff(db: Db, actor: Actor): Promise<number> {
  requireStaff(actor);
  const visible = visibleClientsCondition(db, actor);
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(messages)
    .innerJoin(conversations, and(eq(conversations.id, messages.conversationId), eq(conversations.firmId, messages.firmId)))
    .innerJoin(clients, eq(clients.id, conversations.clientId))
    .leftJoin(conversationReads, and(eq(conversationReads.conversationId, conversations.id), eq(conversationReads.userId, actor.userId)))
    .where(
      and(
        inFirm(messages.firmId, actor),
        visible,
        eq(messages.fromClient, true),
        eq(messages.isInternal, false),
        or(isNull(conversationReads.lastReadAt), gt(messages.createdAt, conversationReads.lastReadAt)),
      ),
    );
  return row?.n ?? 0;
}

/** Unread staff messages for the portal user (internal notes never counted). `clientId` is re-validated. */
export async function countUnreadForClient(db: Db, actor: Actor, clientId?: string): Promise<number> {
  if (actor.role !== "client") throw new ForbiddenError();
  const client = await resolvePortalClient(db, actor, clientId ?? null);
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(messages)
    .innerJoin(conversations, and(eq(conversations.id, messages.conversationId), eq(conversations.firmId, messages.firmId)))
    .leftJoin(conversationReads, and(eq(conversationReads.conversationId, conversations.id), eq(conversationReads.userId, actor.userId)))
    .where(
      and(
        inFirm(messages.firmId, actor),
        eq(conversations.clientId, client.clientId),
        eq(messages.isInternal, false),
        or(isNull(messages.authorId), ne(messages.authorId, actor.userId)),
        or(isNull(conversationReads.lastReadAt), gt(messages.createdAt, conversationReads.lastReadAt)),
      ),
    );
  return row?.n ?? 0;
}

/* ───────── Back-compat (single "General" thread per client) ───────── */

/** The client's most recent open General conversation, created if there is none. */
async function generalConversation(db: Db, actor: Actor, clientId: string): Promise<ConversationRow> {
  const [existing] = await db
    .select()
    .from(conversations)
    .where(and(inFirm(conversations.firmId, actor), eq(conversations.clientId, clientId), eq(conversations.subject, "General"), ne(conversations.status, "closed")))
    .orderBy(desc(conversations.lastMessageAt))
    .limit(1);
  if (existing) return existing;
  const [c] = await db
    .insert(conversations)
    .values({
      firmId: actor.firmId,
      clientId,
      conversationNumber: await nextNumber(db, actor.firmId, "conversation" as CounterKind),
      subject: "General",
      category: "general_inquiry",
      createdById: actor.userId,
      status: actor.role === "client" ? "waiting_for_staff" : "waiting_for_client",
    })
    .returning();
  return c!;
}

async function resolveLegacyClient(db: Db, actor: Actor, clientId?: string): Promise<string> {
  if (actor.role === "client") return (await resolvePortalClient(db, actor, clientId ?? null)).clientId;
  if (!clientId) throw new ForbiddenError();
  await assertClientAccess(db, actor, clientId);
  return clientId;
}

/** Back-compat: posts a client-visible message into the client's General conversation. */
export async function sendMessage(db: Db, actor: Actor, body: unknown, clientId?: string) {
  const resolved = await resolveLegacyClient(db, actor, clientId);
  if (actor.role !== "client") requirePermission(actor, "messages", "reply");
  const text = parseInput(messageBodySchema, body);
  return db.transaction(async (txRaw) => {
    const t = txRaw as unknown as Db;
    const c = await generalConversation(t, actor, resolved);
    const msg = await insertMessage(t, actor, c, { body: text });
    await setStatusInternal(t, actor, c, actor.role === "client" ? "waiting_for_staff" : "waiting_for_client");
    return msg;
  });
}

export interface ThreadMessage {
  id: string;
  body: string;
  fromClient: boolean;
  authorName: string | null;
  createdAt: Date;
  mine: boolean;
}

/** Back-compat: every client-visible message of a client (all conversations), marking them read. */
export async function getThread(db: Db, actor: Actor, clientId?: string): Promise<ThreadMessage[]> {
  const resolved = await resolveLegacyClient(db, actor, clientId);
  const convs = await db.select({ id: conversations.id }).from(conversations).where(and(inFirm(conversations.firmId, actor), eq(conversations.clientId, resolved)));
  const list = await messageRows(db, actor, and(eq(messages.clientId, resolved), eq(messages.isInternal, false))!);
  for (const c of convs) await markRead(db, actor, c.id);
  return list.map(({ isInternal: _i, attachments: _a, ...m }) => (void _i, void _a, m));
}

export type ConversationSummary = InboxRow;

/** Back-compat name for the staff inbox (all folders). */
export async function listConversations(db: Db, actor: Actor): Promise<InboxRow[]> {
  if (actor.role === "client") throw new ForbiddenError();
  return listInbox(db, actor, { folder: "all" });
}

/** Latest conversation of a client (redirect old /staff/messages/<clientId> links). */
export async function latestConversationForClient(db: Db, actor: Actor, clientId: string): Promise<string | null> {
  await assertClientAccess(db, actor, clientId);
  const [row] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(inFirm(conversations.firmId, actor), eq(conversations.clientId, clientId)))
    .orderBy(desc(conversations.lastMessageAt))
    .limit(1);
  return row?.id ?? null;
}

/** Is this id a conversation (vs. an old client-id link)? Only checks the actor's firm. */
export async function isConversationId(db: Db, actor: Actor, id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const [row] = await db.select({ id: conversations.id }).from(conversations).where(and(eq(conversations.id, id), inFirm(conversations.firmId, actor)));
  return !!row;
}
