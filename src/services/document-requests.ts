import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db";
import {
  clientContacts,
  clients,
  documentRequestItems,
  documentRequests,
  documents,
  engagements,
  taxPreparationCases,
  users,
  type DocumentCategory,
} from "@/db/schema";
import type { Actor } from "@/lib/auth/actor";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { isUuid, parseInput } from "@/lib/validation";
import { assertClientAccess, inFirm, requirePermission, visibleClientsCondition } from "./access";
import { recordAudit } from "./audit";
import { notifyClientUsers } from "./client-notifications";
import { assertPortalClientAccess } from "./portal-access";
import { logActivity, nextNumber, type CounterKind } from "./timeline";

/**
 * Document requests: "please send us these documents". A request has items; each item is
 * fulfilled by an uploaded document (the current version). Uploading never verifies anything:
 * an item is verified only when staff verify its document. A request is fulfilled when every
 * REQUIRED item is verified (or waived); "overdue" is computed on read (due date passed).
 */

export type RequestStatus = "draft" | "sent" | "partially_fulfilled" | "fulfilled" | "overdue" | "cancelled";
export type ItemStatus = "pending" | "uploaded" | "under_review" | "verified" | "rejected" | "replacement_requested" | "waived";

const CATEGORIES = documents.category.enumValues;
const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const isoDate = z.preprocess(blank, z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use the format YYYY-MM-DD.").optional());
const optUuid = (label: string) => z.preprocess(blank, z.uuid(`Choose a valid ${label}.`).optional());

const requestSchema = z.object({
  clientId: z.uuid("Choose a client."),
  title: z.string({ error: "Give the request a title." }).trim().min(1, "Give the request a title.").max(200),
  description: z.preprocess(blank, z.string().trim().max(2000).optional()),
  engagementId: optUuid("engagement"),
  taxPreparationCaseId: optUuid("tax preparation case"),
  assignedContactId: optUuid("contact"),
  dueDate: isoDate,
  send: z.preprocess((v) => v === true || v === "on" || v === "true", z.boolean()).default(false),
  items: z
    .array(
      z.object({
        title: z.string({ error: "Describe the document." }).trim().min(1, "Describe the document.").max(200),
        category: z.enum(CATEGORIES, { error: "Choose a category." }).default("other"),
        required: z.preprocess((v) => v === undefined || v === true || v === "on" || v === "true", z.boolean()),
        description: z.preprocess(blank, z.string().trim().max(1000).optional()),
      }),
    )
    .min(1, "Add at least one document to request.")
    .max(50, "Up to 50 documents per request."),
});

/** Window in which an identical request (same client + title) is treated as a double submit. */
const DUPLICATE_WINDOW_MS = 60_000;

function effectiveStatus(status: RequestStatus, dueDate: string | null, today: string): RequestStatus {
  if ((status === "sent" || status === "partially_fulfilled") && dueDate && dueDate < today) return "overdue";
  return status;
}

const todayIso = () => new Date().toISOString().slice(0, 10);

/**
 * Creates a request (draft, or sent when `send`). Idempotent against double submits:
 * an identical request (same client + title, not cancelled) created by the same person within
 * the last minute is returned instead of creating a second one.
 */
export async function createDocumentRequest(db: Db, actor: Actor, input: unknown): Promise<{ id: string; created: boolean }> {
  requirePermission(actor, "documents", "request");
  const d = parseInput(requestSchema, input);
  await assertClientAccess(db, actor, d.clientId);
  if (d.engagementId) {
    const [e] = await db.select({ clientId: engagements.clientId }).from(engagements).where(and(eq(engagements.id, d.engagementId), inFirm(engagements.firmId, actor)));
    if (!e || e.clientId !== d.clientId) throw new ValidationError({ engagementId: ["That engagement belongs to a different client."] });
  }
  if (d.taxPreparationCaseId) {
    const [c] = await db.select({ clientId: taxPreparationCases.clientId }).from(taxPreparationCases).where(and(eq(taxPreparationCases.id, d.taxPreparationCaseId), inFirm(taxPreparationCases.firmId, actor)));
    if (!c || c.clientId !== d.clientId) throw new ValidationError({ taxPreparationCaseId: ["That tax preparation case belongs to a different client."] });
  }
  if (d.assignedContactId) {
    const [c] = await db.select({ clientId: clientContacts.clientId }).from(clientContacts).where(and(eq(clientContacts.id, d.assignedContactId), inFirm(clientContacts.firmId, actor)));
    if (!c || c.clientId !== d.clientId) throw new ValidationError({ assignedContactId: ["That contact belongs to a different client."] });
  }

  const [dupe] = await db
    .select({ id: documentRequests.id })
    .from(documentRequests)
    .where(
      and(
        inFirm(documentRequests.firmId, actor),
        eq(documentRequests.clientId, d.clientId),
        eq(documentRequests.requestedById, actor.userId),
        sql`lower(${documentRequests.title}) = ${d.title.toLowerCase()}`,
        sql`${documentRequests.status} <> 'cancelled'`,
        gte(documentRequests.createdAt, new Date(Date.now() - DUPLICATE_WINDOW_MS)),
      ),
    )
    .limit(1);
  if (dupe) return { id: dupe.id, created: false };

  const id = await db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Db;
    const [req] = await tx
      .insert(documentRequests)
      .values({
        firmId: actor.firmId,
        clientId: d.clientId,
        requestNumber: await nextNumber(tx, actor.firmId, "document_request" as CounterKind),
        engagementId: d.engagementId ?? null,
        taxPreparationCaseId: d.taxPreparationCaseId ?? null,
        assignedContactId: d.assignedContactId ?? null,
        title: d.title,
        description: d.description ?? null,
        dueDate: d.dueDate ?? null,
        requestedById: actor.userId,
        status: "draft",
      })
      .returning({ id: documentRequests.id });
    await tx.insert(documentRequestItems).values(
      d.items.map((it, i) => ({
        firmId: actor.firmId,
        requestId: req!.id,
        title: it.title,
        category: it.category,
        required: it.required,
        description: it.description ?? null,
        sequence: i,
      })),
    );
    await logActivity(tx, actor, { entityType: "client", entityId: d.clientId, clientId: d.clientId, type: "system", body: `Document request created: ${d.title} (${d.items.length} item${d.items.length === 1 ? "" : "s"})`, metadata: { documentRequestId: req!.id } });
    await recordAudit(tx, { firmId: actor.firmId, actorUserId: actor.userId, action: "document_request.create", entityType: "document_request", entityId: req!.id, metadata: { clientId: d.clientId, items: d.items.length } });
    return req!.id;
  });
  if (d.send) await sendDocumentRequest(db, actor, id);
  return { id, created: true };
}

async function loadRequestForStaff(db: Db, actor: Actor, id: string) {
  if (!isUuid(id)) throw new NotFoundError();
  const [req] = await db.select().from(documentRequests).where(and(eq(documentRequests.id, id), inFirm(documentRequests.firmId, actor)));
  if (!req) throw new NotFoundError();
  await assertClientAccess(db, actor, req.clientId);
  return req;
}

/** Sends a draft request: the client sees it in the portal (in-app notification only — no email). */
export async function sendDocumentRequest(db: Db, actor: Actor, id: string): Promise<void> {
  requirePermission(actor, "documents", "request");
  const req = await loadRequestForStaff(db, actor, id);
  if (req.status !== "draft") {
    if (req.status === "cancelled") throw new ValidationError({ _form: ["This request was cancelled."] });
    return; // already sent: sending twice changes nothing
  }
  await db.update(documentRequests).set({ status: "sent", sentAt: new Date(), updatedAt: new Date() }).where(and(eq(documentRequests.id, id), inFirm(documentRequests.firmId, actor)));
  await notifyClientUsers(db, actor.firmId, req.clientId, { type: "document_request", title: `Documents requested: ${req.title}`, href: "/portal/documents", dedupeKey: `docreq:${id}` });
  await logActivity(db, actor, { entityType: "client", entityId: req.clientId, clientId: req.clientId, type: "system", body: `Document request sent: ${req.title}`, metadata: { documentRequestId: id } });
  await recordAudit(db, { firmId: actor.firmId, actorUserId: actor.userId, action: "document_request.send", entityType: "document_request", entityId: id });
}

export async function cancelDocumentRequest(db: Db, actor: Actor, id: string): Promise<void> {
  requirePermission(actor, "documents", "request");
  const req = await loadRequestForStaff(db, actor, id);
  if (req.status === "cancelled") return;
  if (req.status === "fulfilled") throw new ValidationError({ _form: ["A fulfilled request can’t be cancelled."] });
  await db.update(documentRequests).set({ status: "cancelled", updatedAt: new Date() }).where(and(eq(documentRequests.id, id), inFirm(documentRequests.firmId, actor)));
  await logActivity(db, actor, { entityType: "client", entityId: req.clientId, clientId: req.clientId, type: "system", body: `Document request cancelled: ${req.title}`, metadata: { documentRequestId: id } });
  await recordAudit(db, { firmId: actor.firmId, actorUserId: actor.userId, action: "document_request.cancel", entityType: "document_request", entityId: id });
}

/** Marks an item as not needed (counts as satisfied). */
export async function waiveRequestItem(db: Db, actor: Actor, itemId: string): Promise<void> {
  requirePermission(actor, "documents", "verify");
  if (!isUuid(itemId)) throw new NotFoundError();
  const [item] = await db.select().from(documentRequestItems).where(and(eq(documentRequestItems.id, itemId), inFirm(documentRequestItems.firmId, actor)));
  if (!item) throw new NotFoundError();
  const req = await loadRequestForStaff(db, actor, item.requestId);
  await db.update(documentRequestItems).set({ status: "waived", updatedAt: new Date() }).where(and(eq(documentRequestItems.id, itemId), inFirm(documentRequestItems.firmId, actor)));
  await logActivity(db, actor, { entityType: "client", entityId: req.clientId, clientId: req.clientId, type: "system", body: `Marked not needed: ${item.title}`, metadata: { documentRequestId: req.id } });
  await recomputeRequestStatus(db, actor.firmId, req.id);
}

/**
 * Re-derives a request's status from its items (never touches draft/cancelled requests):
 * all required items verified/waived → fulfilled; any item with a file → partially fulfilled; else sent.
 */
export async function recomputeRequestStatus(db: Db, firmId: string, requestId: string): Promise<RequestStatus | null> {
  const [req] = await db.select({ status: documentRequests.status }).from(documentRequests).where(and(eq(documentRequests.id, requestId), eq(documentRequests.firmId, firmId)));
  if (!req || req.status === "draft" || req.status === "cancelled") return req?.status ?? null;
  const items = await db.select({ status: documentRequestItems.status, required: documentRequestItems.required }).from(documentRequestItems).where(and(eq(documentRequestItems.requestId, requestId), eq(documentRequestItems.firmId, firmId)));
  const done = (s: ItemStatus) => s === "verified" || s === "waived";
  const required = items.filter((i) => i.required);
  const next: RequestStatus =
    (required.length ? required : items).every((i) => done(i.status)) ? "fulfilled" : items.some((i) => i.status !== "pending") ? "partially_fulfilled" : "sent";
  if (next !== req.status) await db.update(documentRequests).set({ status: next, updatedAt: new Date() }).where(and(eq(documentRequests.id, requestId), eq(documentRequests.firmId, firmId)));
  return next;
}

/** Item status that mirrors its document's review status. */
export function itemStatusFromDocument(status: string): ItemStatus | null {
  switch (status) {
    case "uploaded":
      return "uploaded";
    case "under_review":
      return "under_review";
    case "verified":
      return "verified";
    case "rejected":
      return "rejected";
    case "replacement_requested":
      return "replacement_requested";
    default:
      return null;
  }
}

/**
 * Validates that a portal user may upload against `itemId` for `clientId`: the item belongs to an
 * open (sent / partially fulfilled) request of that client, and still needs a file.
 */
export async function assertPortalUploadableItem(db: Db, actor: Actor, clientId: string, itemId: string) {
  await assertPortalClientAccess(db, actor, clientId);
  if (!isUuid(itemId)) throw new NotFoundError();
  const [row] = await db
    .select({ item: documentRequestItems, req: documentRequests })
    .from(documentRequestItems)
    .innerJoin(documentRequests, and(eq(documentRequests.id, documentRequestItems.requestId), eq(documentRequests.firmId, documentRequestItems.firmId)))
    .where(and(eq(documentRequestItems.id, itemId), eq(documentRequestItems.firmId, actor.firmId), eq(documentRequests.clientId, clientId)));
  if (!row) throw new NotFoundError();
  if (row.req.status !== "sent" && row.req.status !== "partially_fulfilled") throw new ValidationError({ itemId: ["This request is no longer open."] });
  if (row.item.status === "verified" || row.item.status === "waived") throw new ValidationError({ itemId: ["This document was already accepted."] });
  return row;
}

/* ───────── Reads ───────── */

export interface RequestItemView {
  id: string;
  title: string;
  description: string | null;
  category: DocumentCategory;
  required: boolean;
  status: ItemStatus;
  sequence: number;
  document: { id: string; title: string | null; fileName: string; status: string; versionNumber: number; reviewNote: string | null; createdAt: Date } | null;
}

export interface RequestView {
  id: string;
  requestNumber: number | null;
  clientId: string;
  clientName: string;
  title: string;
  description: string | null;
  status: RequestStatus;
  dueDate: string | null;
  engagementId: string | null;
  engagementTitle: string | null;
  requestedByName: string | null;
  sentAt: Date | null;
  createdAt: Date;
  total: number;
  done: number;
  items: RequestItemView[];
}

async function loadItems(db: Db, firmId: string, requestIds: string[], portal: boolean): Promise<Map<string, RequestItemView[]>> {
  const out = new Map<string, RequestItemView[]>();
  if (!requestIds.length) return out;
  const rows = await db
    .select({
      item: documentRequestItems,
      docId: documents.id,
      docTitle: documents.title,
      docFileName: documents.fileName,
      docStatus: documents.status,
      docVersion: documents.versionNumber,
      docReviewNote: documents.reviewNote,
      docCreatedAt: documents.createdAt,
      docVisibility: documents.visibility,
      docDeleted: documents.deletedAt,
    })
    .from(documentRequestItems)
    .leftJoin(documents, and(eq(documents.id, documentRequestItems.fulfilledDocumentId), eq(documents.firmId, documentRequestItems.firmId)))
    .where(and(eq(documentRequestItems.firmId, firmId), inArray(documentRequestItems.requestId, requestIds)))
    .orderBy(asc(documentRequestItems.sequence));
  for (const r of rows) {
    // Portal users only ever see documents that are visible to them.
    const showDoc = r.docId && !r.docDeleted && (!portal || r.docVisibility !== "internal_only");
    const view: RequestItemView = {
      id: r.item.id,
      title: r.item.title,
      description: r.item.description,
      category: r.item.category,
      required: r.item.required,
      status: r.item.status,
      sequence: r.item.sequence,
      document: showDoc
        ? { id: r.docId!, title: r.docTitle, fileName: r.docFileName!, status: r.docStatus!, versionNumber: r.docVersion!, reviewNote: r.docReviewNote, createdAt: r.docCreatedAt! }
        : null,
    };
    out.set(r.item.requestId, [...(out.get(r.item.requestId) ?? []), view]);
  }
  return out;
}

function toView(r: { req: typeof documentRequests.$inferSelect; clientName: string; engagementTitle: string | null; requestedByName: string | null }, items: RequestItemView[], today: string): RequestView {
  return {
    id: r.req.id,
    requestNumber: r.req.requestNumber,
    clientId: r.req.clientId,
    clientName: r.clientName,
    title: r.req.title,
    description: r.req.description,
    status: effectiveStatus(r.req.status, r.req.dueDate, today),
    dueDate: r.req.dueDate,
    engagementId: r.req.engagementId,
    engagementTitle: r.engagementTitle,
    requestedByName: r.requestedByName,
    sentAt: r.req.sentAt,
    createdAt: r.req.createdAt,
    total: items.filter((i) => i.required).length || items.length,
    done: items.filter((i) => (items.some((x) => x.required) ? i.required : true) && (i.status === "verified" || i.status === "waived")).length,
    items,
  };
}

/** Staff list of requests the actor can see (optionally one client / one status). */
export async function listDocumentRequests(db: Db, actor: Actor, f: { clientId?: string; status?: RequestStatus | "open"; today?: string } = {}): Promise<RequestView[]> {
  requirePermission(actor, "documents", "view");
  const today = f.today ?? todayIso();
  const rows = await db
    .select({ req: documentRequests, clientName: clients.displayName, engagementTitle: engagements.title, requestedByName: users.name })
    .from(documentRequests)
    .innerJoin(clients, eq(clients.id, documentRequests.clientId))
    .leftJoin(engagements, and(eq(engagements.id, documentRequests.engagementId), eq(engagements.firmId, documentRequests.firmId)))
    .leftJoin(users, eq(users.id, documentRequests.requestedById))
    .where(and(inFirm(documentRequests.firmId, actor), visibleClientsCondition(db, actor), f.clientId && isUuid(f.clientId) ? eq(documentRequests.clientId, f.clientId) : undefined))
    .orderBy(desc(documentRequests.createdAt))
    .limit(500);
  const items = await loadItems(db, actor.firmId, rows.map((r) => r.req.id), false);
  const views = rows.map((r) => toView(r, items.get(r.req.id) ?? [], today));
  if (!f.status) return views;
  if (f.status === "open") return views.filter((v) => ["draft", "sent", "partially_fulfilled", "overdue"].includes(v.status));
  return views.filter((v) => v.status === f.status);
}

export async function getDocumentRequest(db: Db, actor: Actor, id: string, today = todayIso()): Promise<RequestView> {
  requirePermission(actor, "documents", "view");
  const req = await loadRequestForStaff(db, actor, id);
  const [names] = await db
    .select({ clientName: clients.displayName, engagementTitle: engagements.title, requestedByName: users.name })
    .from(documentRequests)
    .innerJoin(clients, eq(clients.id, documentRequests.clientId))
    .leftJoin(engagements, and(eq(engagements.id, documentRequests.engagementId), eq(engagements.firmId, documentRequests.firmId)))
    .leftJoin(users, eq(users.id, documentRequests.requestedById))
    .where(eq(documentRequests.id, id));
  const items = await loadItems(db, actor.firmId, [id], false);
  return toView({ req, clientName: names?.clientName ?? "", engagementTitle: names?.engagementTitle ?? null, requestedByName: names?.requestedByName ?? null }, items.get(id) ?? [], today);
}

/** The portal's open requests for the client being viewed (never drafts or cancelled ones). */
export async function listPortalDocumentRequests(db: Db, actor: Actor, clientId: string, today = todayIso()): Promise<RequestView[]> {
  if (actor.role !== "client") throw new ForbiddenError();
  await assertPortalClientAccess(db, actor, clientId);
  const rows = await db
    .select({ req: documentRequests, clientName: clients.displayName, engagementTitle: engagements.title, requestedByName: sql<string | null>`null` })
    .from(documentRequests)
    .innerJoin(clients, eq(clients.id, documentRequests.clientId))
    .leftJoin(engagements, and(eq(engagements.id, documentRequests.engagementId), eq(engagements.firmId, documentRequests.firmId)))
    .where(and(eq(documentRequests.firmId, actor.firmId), eq(documentRequests.clientId, clientId), inArray(documentRequests.status, ["sent", "partially_fulfilled", "fulfilled"])))
    .orderBy(desc(documentRequests.createdAt))
    .limit(100);
  const items = await loadItems(db, actor.firmId, rows.map((r) => r.req.id), true);
  return rows.map((r) => toView(r, items.get(r.req.id) ?? [], today));
}
