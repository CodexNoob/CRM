import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, notInArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db";
import {
  clients,
  conversationReads,
  conversations,
  documentRequestItems,
  documentRequests,
  documents,
  engagements,
  messages,
  signatureRequests,
  tasks,
  users,
  type EngagementStatus,
  type ServiceType,
  type TaskStatus,
} from "@/db/schema";
import type { Actor } from "@/lib/auth/actor";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { ENGAGEMENT_DONE, TASK_OPEN } from "@/lib/status";
import { parseInput } from "@/lib/validation";
import { recordAudit } from "./audit";
import { listPortalNotifications, type PortalNotification } from "./client-notifications";
import { assertPortalClientAccess } from "./portal-access";
import { getOrganizationProfile } from "./settings";
import { logActivity } from "./timeline";

/**
 * The client's view of their own work. Every function takes the client id resolved on the
 * server (requirePortalContext) and re-checks it against portal_client_access. Only fields
 * that are safe for clients are selected: no internal tasks, notes, staff assignments,
 * internal-only documents or audit data.
 */

function requirePortalUser(actor: Actor) {
  if (actor.role !== "client") throw new ForbiddenError();
}

/** Resolves and re-checks the client (defaults to the login's own client for older callers). */
async function portalClientId(db: Db, actor: Actor, clientId?: string): Promise<string> {
  requirePortalUser(actor);
  const id = clientId ?? actor.clientId;
  if (!id) throw new ForbiddenError();
  await assertPortalClientAccess(db, actor, id);
  return id;
}

/** Engagements a client sees: not internal drafts. */
const CLIENT_HIDDEN: EngagementStatus[] = ["draft"];

export interface PortalOverview {
  clientName: string;
  engagements: {
    id: string;
    title: string;
    serviceType: ServiceType;
    taxYear: number | null;
    status: EngagementStatus;
    dueDate: string | null;
    contactName: string;
    tasks: { id: string; title: string; status: TaskStatus; dueDate: string | null }[];
  }[];
}

export async function getPortalOverview(db: Db, actor: Actor, clientIdHint?: string): Promise<PortalOverview> {
  const clientId = await portalClientId(db, actor, clientIdHint);
  const [client] = await db.select({ name: clients.displayName }).from(clients).where(and(eq(clients.id, clientId), eq(clients.firmId, actor.firmId)));

  const rows = await db
    .select({
      id: engagements.id,
      title: engagements.title,
      serviceType: engagements.serviceType,
      taxYear: engagements.taxYear,
      status: engagements.status,
      dueDate: engagements.dueDate,
      contactName: users.name,
    })
    .from(engagements)
    .innerJoin(users, eq(users.id, engagements.ownerId))
    .where(and(eq(engagements.firmId, actor.firmId), eq(engagements.clientId, clientId), notInArray(engagements.status, CLIENT_HIDDEN)))
    .orderBy(desc(engagements.createdAt));

  const ids = rows.map((r) => r.id);
  const clientTasks = ids.length
    ? await db
        .select({ id: tasks.id, engagementId: tasks.engagementId, title: tasks.title, status: tasks.status, dueDate: tasks.dueDate })
        .from(tasks)
        .where(and(eq(tasks.firmId, actor.firmId), eq(tasks.clientId, clientId), inArray(tasks.engagementId, ids), eq(tasks.isClientTask, true), isNull(tasks.archivedAt)))
        .orderBy(asc(tasks.status), sql`${tasks.dueDate} asc nulls last`, asc(tasks.createdAt))
    : [];

  return {
    clientName: client?.name ?? "",
    engagements: rows.map((e) => ({
      ...e,
      tasks: clientTasks.filter((t) => t.engagementId === e.id).map(({ id, title, status, dueDate }) => ({ id, title, status, dueDate })),
    })),
  };
}

/* ───────── Overview summary ───────── */

export interface PortalDeadline {
  kind: "engagement" | "task" | "document_request";
  id: string;
  title: string;
  dueDate: string;
  href: string;
}

export interface PortalSummary {
  activeEngagements: number;
  outstandingDocumentItems: number;
  documentsAwaitingReview: number;
  pendingSignatures: number;
  unreadMessages: number;
  openClientTasks: number;
  deadlines: PortalDeadline[];
  recent: PortalNotification[];
}

/** Staff messages in this client's conversations the user hasn't read yet (never internal notes). */
export async function countPortalUnreadMessages(db: Db, actor: Actor, clientIdHint?: string): Promise<number> {
  const clientId = await portalClientId(db, actor, clientIdHint);
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(messages)
    .leftJoin(conversations, and(eq(conversations.id, messages.conversationId), eq(conversations.firmId, messages.firmId)))
    .leftJoin(conversationReads, and(eq(conversationReads.conversationId, messages.conversationId), eq(conversationReads.userId, actor.userId)))
    .where(
      and(
        eq(messages.firmId, actor.firmId),
        eq(messages.clientId, clientId),
        eq(messages.fromClient, false),
        eq(messages.isInternal, false),
        // Read position per user when known; otherwise the older single read flag.
        sql`(case when ${conversationReads.lastReadAt} is not null then ${messages.createdAt} > ${conversationReads.lastReadAt} else ${messages.readAt} is null end)`,
      ),
    );
  return row?.n ?? 0;
}

export async function getPortalSummary(db: Db, actor: Actor, clientIdHint: string, today: string): Promise<PortalSummary> {
  const clientId = await portalClientId(db, actor, clientIdHint);
  const in60 = new Date(Date.parse(`${today}T00:00:00Z`) + 60 * 86_400_000).toISOString().slice(0, 10);
  const firm = eq(engagements.firmId, actor.firmId);

  const [eng] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(engagements)
    .where(and(firm, eq(engagements.clientId, clientId), notInArray(engagements.status, [...CLIENT_HIDDEN, ...ENGAGEMENT_DONE])));

  // Only requests that were actually sent are visible to clients (drafts are internal).
  const visibleRequest = and(eq(documentRequests.firmId, actor.firmId), eq(documentRequests.clientId, clientId), inArray(documentRequests.status, ["sent", "partially_fulfilled", "overdue"]));
  const [items] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(documentRequestItems)
    .innerJoin(documentRequests, and(eq(documentRequests.id, documentRequestItems.requestId), eq(documentRequests.firmId, documentRequestItems.firmId)))
    .where(and(visibleRequest, inArray(documentRequestItems.status, ["pending", "rejected", "replacement_requested"])));

  // Documents the client can see (shared with them, or their own uploads) that are waiting for the firm's review.
  const [review] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(documents)
    .where(
      and(
        eq(documents.firmId, actor.firmId),
        eq(documents.clientId, clientId),
        isNull(documents.deletedAt),
        eq(documents.isCurrentVersion, true),
        or(eq(documents.uploadedByClient, true), ne(documents.visibility, "internal_only")),
        inArray(documents.status, ["uploaded", "under_review"]),
      ),
    );

  const [sig] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(signatureRequests)
    .where(and(eq(signatureRequests.firmId, actor.firmId), eq(signatureRequests.clientId, clientId), inArray(signatureRequests.status, ["sent", "viewed", "partially_signed"])));

  const [openTasks] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(tasks)
    .where(and(eq(tasks.firmId, actor.firmId), eq(tasks.clientId, clientId), eq(tasks.isClientTask, true), isNull(tasks.archivedAt), inArray(tasks.status, [...TASK_OPEN])));

  // Client-visible deadlines: engagement due dates, the client's own to-dos, sent document requests.
  const engDeadlines = await db
    .select({ id: engagements.id, title: engagements.title, dueDate: engagements.dueDate })
    .from(engagements)
    .where(and(firm, eq(engagements.clientId, clientId), notInArray(engagements.status, [...CLIENT_HIDDEN, ...ENGAGEMENT_DONE]), gte(engagements.dueDate, today), lte(engagements.dueDate, in60)));
  const taskDeadlines = await db
    .select({ id: tasks.id, title: tasks.title, dueDate: tasks.dueDate })
    .from(tasks)
    .where(and(eq(tasks.firmId, actor.firmId), eq(tasks.clientId, clientId), eq(tasks.isClientTask, true), isNull(tasks.archivedAt), inArray(tasks.status, [...TASK_OPEN]), lte(tasks.dueDate, in60)));
  const requestDeadlines = await db
    .select({ id: documentRequests.id, title: documentRequests.title, dueDate: documentRequests.dueDate })
    .from(documentRequests)
    .where(and(visibleRequest, lte(documentRequests.dueDate, in60)));

  const deadlines: PortalDeadline[] = [
    ...engDeadlines.map((d) => ({ kind: "engagement" as const, id: d.id, title: d.title, dueDate: d.dueDate!, href: "/portal/services" })),
    ...taskDeadlines.map((d) => ({ kind: "task" as const, id: d.id, title: d.title, dueDate: d.dueDate!, href: "/portal" })),
    ...requestDeadlines.map((d) => ({ kind: "document_request" as const, id: d.id, title: d.title, dueDate: d.dueDate!, href: "/portal/documents" })),
  ]
    .filter((d) => !!d.dueDate)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, 8);

  return {
    activeEngagements: eng?.n ?? 0,
    outstandingDocumentItems: items?.n ?? 0,
    documentsAwaitingReview: review?.n ?? 0,
    pendingSignatures: sig?.n ?? 0,
    unreadMessages: await countPortalUnreadMessages(db, actor, clientId),
    openClientTasks: openTasks?.n ?? 0,
    deadlines,
    // Portal-safe activity: notifications written for clients (never staff timeline text).
    recent: (await listPortalNotifications(db, actor, clientId, 6)) ?? [],
  };
}

/* ───────── My Services ───────── */

export interface PortalService {
  id: string;
  title: string;
  serviceType: ServiceType;
  taxYear: number | null;
  periodStart: string | null;
  periodEnd: string | null;
  status: EngagementStatus;
  description: string | null;
  startDate: string | null;
  dueDate: string | null;
  /** Share of the engagement's tasks that are completed (no task titles exposed). */
  progressPercent: number | null;
}

export interface PortalServices {
  services: PortalService[];
  accountManager: { name: string; email: string | null } | null;
  firm: {
    name: string;
    phone: string;
    email: string;
    websiteUrl: string;
    description: string;
    addressLines: string[];
    hours: [string, string][];
    socialLinks: { label: string; url: string }[];
  };
}

export async function listPortalServices(db: Db, actor: Actor, clientIdHint: string): Promise<PortalServices> {
  const clientId = await portalClientId(db, actor, clientIdHint);
  const rows = await db
    .select({
      id: engagements.id,
      title: engagements.title,
      serviceType: engagements.serviceType,
      taxYear: engagements.taxYear,
      periodStart: engagements.periodStart,
      periodEnd: engagements.periodEnd,
      status: engagements.status,
      description: engagements.description,
      startDate: engagements.startDate,
      dueDate: engagements.dueDate,
      total: sql<number>`(select count(*)::int from ${tasks} t where t.engagement_id = ${engagements.id} and t.firm_id = ${engagements.firmId} and t.archived_at is null and t.status <> 'cancelled')`,
      completed: sql<number>`(select count(*)::int from ${tasks} t where t.engagement_id = ${engagements.id} and t.firm_id = ${engagements.firmId} and t.archived_at is null and t.status = 'completed')`,
    })
    .from(engagements)
    .where(and(eq(engagements.firmId, actor.firmId), eq(engagements.clientId, clientId), notInArray(engagements.status, [...CLIENT_HIDDEN, "cancelled"])))
    .orderBy(sql`${engagements.dueDate} asc nulls last`, desc(engagements.createdAt));

  const [mgr] = await db
    .select({ name: users.name, email: users.email })
    .from(clients)
    .innerJoin(users, eq(users.id, clients.accountManagerId))
    .where(and(eq(clients.id, clientId), eq(clients.firmId, actor.firmId)));
  const profile = await getOrganizationProfile(db, actor.firmId);

  return {
    services: rows.map(({ total, completed, ...e }) => ({ ...e, progressPercent: total > 0 ? Math.round((completed / total) * 100) : null })),
    accountManager: mgr ? { name: mgr.name, email: mgr.email } : null,
    firm: {
      name: profile.name,
      phone: profile.phone,
      email: profile.email,
      websiteUrl: profile.websiteUrl,
      description: profile.description,
      addressLines: profile.addressLines,
      hours: profile.hours,
      socialLinks: profile.socialLinks,
    },
  };
}

/* ───────── My Profile ───────── */

export interface PortalProfile {
  name: string;
  email: string;
  client: { name: string; phone: string | null; email: string | null; address: string | null };
}

export async function getPortalProfile(db: Db, actor: Actor, clientIdHint: string): Promise<PortalProfile> {
  const clientId = await portalClientId(db, actor, clientIdHint);
  const [me] = await db.select({ name: users.name, email: users.email }).from(users).where(and(eq(users.id, actor.userId), eq(users.firmId, actor.firmId)));
  const [c] = await db
    .select({ name: clients.displayName, phone: clients.phone, email: clients.email, address: clients.address })
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.firmId, actor.firmId)));
  return { name: me?.name ?? actor.name, email: me?.email ?? actor.email, client: c ?? { name: "", phone: null, email: null, address: null } };
}

const nameSchema = z.object({ name: z.string({ error: "Enter your name." }).trim().min(1, "Enter your name.").max(200) });

/** Portal users may change their own display name directly. */
export async function updatePortalUserName(db: Db, actor: Actor, input: unknown): Promise<void> {
  requirePortalUser(actor);
  const { name } = parseInput(nameSchema, input);
  await db.update(users).set({ name, updatedAt: new Date() }).where(and(eq(users.id, actor.userId), eq(users.firmId, actor.firmId), eq(users.role, "client")));
  await recordAudit(db, { firmId: actor.firmId, actorUserId: actor.userId, action: "portal.profile_name", entityType: "user", entityId: actor.userId });
}

const changeSchema = z
  .object({
    phone: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().trim().regex(/^[0-9+().\-\s]{7,30}$/, "Enter a valid phone number.").optional()),
    email: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.email("Enter a valid email address.").max(254).optional()),
    address: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().trim().max(500).optional()),
    note: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().trim().max(1000).optional()),
  })
  .refine((d) => d.phone || d.email || d.address, { path: ["_form"], message: "Enter at least one detail to change." });

/**
 * Contact-detail changes are REQUESTS for staff to verify — the client record is not changed here.
 * The request goes on the client's timeline and notifies the account manager.
 */
export async function requestContactChange(db: Db, actor: Actor, clientIdHint: string, input: unknown): Promise<void> {
  const clientId = await portalClientId(db, actor, clientIdHint);
  const d = parseInput(changeSchema, input);
  const [c] = await db.select({ accountManagerId: clients.accountManagerId }).from(clients).where(and(eq(clients.id, clientId), eq(clients.firmId, actor.firmId)));
  const fields = (["phone", "email", "address"] as const).filter((k) => d[k]);
  if (!fields.length) throw new ValidationError({ _form: ["Enter at least one detail to change."] });
  const summary = fields.map((k) => `${k}: ${d[k]}`).join("; ");
  await logActivity(db, actor, {
    entityType: "client",
    entityId: clientId,
    clientId,
    type: "system",
    body: `Contact details change requested by ${actor.name} (portal) — ${summary}${d.note ? `. Note: ${d.note}` : ""}. Verify before updating the client record.`,
    metadata: { kind: "profile_change_request", notifyUserId: c?.accountManagerId ?? null, fields },
  });
  await recordAudit(db, { firmId: actor.firmId, actorUserId: actor.userId, action: "portal.contact_change_request", entityType: "client", entityId: clientId, metadata: { changedFields: fields } });
}
