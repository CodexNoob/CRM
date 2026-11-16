import { and, desc, eq, inArray, isNotNull, lt, ne, or, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { clients, engagements, invoices, type Invoice, type InvoiceStatus } from "@/db/schema";
import * as paypal from "@/integrations/paypal";
import type { PayPalInvoiceSnapshot, PayPalInvoiceStatus } from "@/integrations/paypal";
import { isManagerOrAdmin, type Actor } from "@/lib/auth/actor";
import { AppError, ForbiddenError, IntegrationNotConfiguredError, NotFoundError, ValidationError } from "@/lib/errors";
import { isUuid, parseInvoiceInput } from "@/lib/validation";
import { assertClientAccess, inFirm, requirePermission, visibleClientsCondition } from "./access";
import { recordAudit } from "./audit";

/**
 * Invoices. PayPal is the system of record: it stores the invoice, emails it,
 * hosts the payment page and records payments. This service keeps a linked copy,
 * enforces who may see or change it, and refreshes status from PayPal.
 */

/** The PayPal operations this service needs (swappable in tests). */
export interface InvoiceProvider {
  readonly isConfigured: boolean;
  readonly currency: string;
  createDraftInvoice: typeof paypal.createDraftInvoice;
  sendInvoice: typeof paypal.sendInvoice;
  getInvoice: typeof paypal.getInvoice;
  cancelInvoice: typeof paypal.cancelInvoice;
  deleteDraftInvoice: typeof paypal.deleteDraftInvoice;
}

export function paypalProvider(): InvoiceProvider {
  const cfg = paypal.paypalConfig();
  return {
    isConfigured: cfg.isConfigured,
    currency: cfg.currency,
    createDraftInvoice: paypal.createDraftInvoice,
    sendInvoice: paypal.sendInvoice,
    getInvoice: paypal.getInvoice,
    cancelInvoice: paypal.cancelInvoice,
    deleteDraftInvoice: paypal.deleteDraftInvoice,
  };
}

const OPEN_STATUSES: InvoiceStatus[] = ["sent", "partially_paid"];
/** How long a synced status is trusted before a page view refreshes it from PayPal. */
const SYNC_TTL_MS = 2 * 60 * 1000;

export function mapPayPalStatus(s: PayPalInvoiceStatus): InvoiceStatus {
  switch (s) {
    case "DRAFT":
      return "draft";
    case "PARTIALLY_PAID":
      return "partially_paid";
    case "PAID":
    case "MARKED_AS_PAID":
    case "PARTIALLY_REFUNDED":
      return "paid";
    case "CANCELLED":
      return "cancelled";
    case "REFUNDED":
    case "MARKED_AS_REFUNDED":
      return "refunded";
    default:
      return "sent"; // SENT, SCHEDULED, UNPAID, PAYMENT_PENDING
  }
}

function requireConfigured(provider: InvoiceProvider) {
  if (!provider.isConfigured) {
    throw new IntegrationNotConfiguredError("PayPal", "add PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET to the server settings.");
  }
}

/** PayPal error descriptions are about the request (never client data), so they are safe to show staff. */
export function paypalFailure(what: string, error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof paypal.PayPalError && error.status === 403) {
    return new AppError(
      `PayPal couldn’t ${what}: this PayPal app doesn’t have permission. In developer.paypal.com, open the app, and under Features turn on Invoicing and Subscriptions, then save.`,
    );
  }
  const detail = error instanceof paypal.PayPalError ? error.message : "the request did not complete";
  return new AppError(`PayPal couldn’t ${what}: ${detail}`);
}

/** Admins and partners handle billing corrections; preparers can create and send. */
function requireBillingManager(actor: Actor) {
  requirePermission(actor, "billing", "edit");
  if (!isManagerOrAdmin(actor)) throw new ForbiddenError("Only an admin or manager can cancel invoices.");
}

async function loadForStaff(db: Db, actor: Actor, id: string): Promise<Invoice> {
  requirePermission(actor, "billing", "view");
  if (!isUuid(id)) throw new NotFoundError();
  const [row] = await db.select().from(invoices).where(and(eq(invoices.id, id), inFirm(invoices.firmId, actor))).limit(1);
  if (!row) throw new NotFoundError();
  await assertClientAccess(db, actor, row.clientId);
  return row;
}

function applySnapshot(snap: PayPalInvoiceSnapshot, now: Date) {
  const status = mapPayPalStatus(snap.status);
  return {
    status,
    paypalInvoiceNumber: snap.invoiceNumber || null,
    payUrl: snap.payUrl,
    paidCents: snap.paidCents,
    syncedAt: now,
    updatedAt: now,
  };
}

/* ───────── Create / send ───────── */

/**
 * Creates the invoice in PayPal and sends it to the client's email.
 * If PayPal accepts the invoice but sending fails, it is kept as a draft that can be re-sent.
 */
export async function createInvoice(
  db: Db,
  actor: Actor,
  clientId: string,
  input: Record<string, unknown>,
  provider: InvoiceProvider = paypalProvider(),
  now = new Date(),
): Promise<Invoice> {
  requirePermission(actor, "billing", "create");
  await assertClientAccess(db, actor, clientId);
  const data = parseInvoiceInput(input);
  const [client] = await db.select({ name: clients.displayName, email: clients.email }).from(clients).where(and(eq(clients.id, clientId), inFirm(clients.firmId, actor)));
  if (!client?.email) {
    throw new ValidationError({ _form: ["This client has no email address. Add one on the client’s details first, so PayPal can send the invoice."] });
  }
  if (data.engagementId) {
    const [eng] = await db.select({ id: engagements.id }).from(engagements).where(and(eq(engagements.id, data.engagementId), eq(engagements.clientId, clientId), inFirm(engagements.firmId, actor)));
    if (!eng) throw new ValidationError({ engagementId: ["Choose one of this client’s engagements."] });
  }
  requireConfigured(provider);

  let draft: PayPalInvoiceSnapshot;
  try {
    draft = await provider.createDraftInvoice({
      recipientName: client.name,
      recipientEmail: client.email,
      currency: provider.currency,
      dueDate: data.dueDate ?? null,
      note: [data.title, data.note].filter(Boolean).join("\n\n"),
      items: data.items,
    });
  } catch (error) {
    throw paypalFailure("create the invoice", error);
  }

  const [row] = await db
    .insert(invoices)
    .values({
      firmId: actor.firmId,
      clientId,
      engagementId: data.engagementId ?? null,
      title: data.title,
      items: data.items,
      currency: provider.currency,
      totalCents: data.totalCents,
      dueDate: data.dueDate ?? null,
      note: data.note ?? null,
      recipientEmail: client.email,
      paypalInvoiceId: draft.id,
      createdById: actor.userId,
      ...applySnapshot(draft, now),
    })
    .returning();
  await recordAudit(db, { firmId: actor.firmId, actorUserId: actor.userId, action: "invoice.create", entityType: "invoice", entityId: row!.id, metadata: { clientId } });

  return sendDraft(db, actor, row!, provider, now);
}

async function sendDraft(db: Db, actor: Actor, row: Invoice, provider: InvoiceProvider, now: Date): Promise<Invoice> {
  if (row.status !== "draft" || !row.paypalInvoiceId) throw new ValidationError({ _form: ["Only a draft invoice can be sent."] });
  let sent: PayPalInvoiceSnapshot;
  try {
    sent = await provider.sendInvoice(row.paypalInvoiceId);
  } catch (error) {
    const e = paypalFailure("send the invoice", error);
    throw new AppError(`${e.message} It was saved as a draft; open it and choose “Send” to try again.`);
  }
  const [updated] = await db
    .update(invoices)
    .set({ ...applySnapshot(sent, now), sentAt: now })
    .where(and(eq(invoices.id, row.id), eq(invoices.firmId, row.firmId)))
    .returning();
  await recordAudit(db, { firmId: row.firmId, actorUserId: actor.userId, action: "invoice.send", entityType: "invoice", entityId: row.id, metadata: { clientId: row.clientId } });
  return updated!;
}

/** Re-sends a draft whose first send failed. */
export async function sendInvoice(db: Db, actor: Actor, id: string, provider: InvoiceProvider = paypalProvider(), now = new Date()): Promise<Invoice> {
  requirePermission(actor, "billing", "edit");
  const row = await loadForStaff(db, actor, id);
  requireConfigured(provider);
  return sendDraft(db, actor, row, provider, now);
}

/* ───────── Cancel ───────── */

export async function cancelInvoice(db: Db, actor: Actor, id: string, provider: InvoiceProvider = paypalProvider(), now = new Date()): Promise<void> {
  requireBillingManager(actor);
  const row = await loadForStaff(db, actor, id);
  if (row.status !== "draft" && row.status !== "sent") {
    throw new ValidationError({ _form: ["Only unpaid invoices can be cancelled. Refunds are handled in PayPal."] });
  }
  requireConfigured(provider);
  if (row.paypalInvoiceId) {
    try {
      if (row.status === "draft") await provider.deleteDraftInvoice(row.paypalInvoiceId);
      else await provider.cancelInvoice(row.paypalInvoiceId);
    } catch (error) {
      throw paypalFailure("cancel the invoice", error);
    }
  }
  await db.update(invoices).set({ status: "cancelled", syncedAt: now, updatedAt: now }).where(and(eq(invoices.id, row.id), eq(invoices.firmId, row.firmId)));
  await recordAudit(db, { firmId: row.firmId, actorUserId: actor.userId, action: "invoice.cancel", entityType: "invoice", entityId: row.id, metadata: { clientId: row.clientId } });
}

/* ───────── Sync from PayPal ───────── */

/** Refreshes one invoice from PayPal. Records `invoice.paid` the first time it is seen as paid. */
async function syncRow(db: Db, row: Invoice, provider: InvoiceProvider, now: Date): Promise<Invoice> {
  if (!row.paypalInvoiceId) return row;
  const snap = await provider.getInvoice(row.paypalInvoiceId);
  const patch = applySnapshot(snap, now);
  const becamePaid = patch.status === "paid" && row.status !== "paid";
  const [updated] = await db
    .update(invoices)
    .set({ ...patch, ...(becamePaid ? { paidAt: now } : {}) })
    .where(and(eq(invoices.id, row.id), eq(invoices.firmId, row.firmId)))
    .returning();
  if (becamePaid) {
    await recordAudit(db, { firmId: row.firmId, actorUserId: null, action: "invoice.paid", entityType: "invoice", entityId: row.id, metadata: { clientId: row.clientId } });
  }
  return updated!;
}

/** Staff "Refresh status" button. */
export async function refreshInvoice(db: Db, actor: Actor, id: string, provider: InvoiceProvider = paypalProvider(), now = new Date()): Promise<Invoice> {
  requirePermission(actor, "billing", "view");
  const row = await loadForStaff(db, actor, id);
  requireConfigured(provider);
  try {
    return await syncRow(db, row, provider, now);
  } catch (error) {
    throw paypalFailure("load the invoice", error);
  }
}

/**
 * Best-effort refresh of open invoices whose status is older than SYNC_TTL_MS.
 * Called before listing; PayPal problems are logged and never block the page.
 */
async function refreshStale(db: Db, where: ReturnType<typeof and>, provider: InvoiceProvider, now: Date, limit = 15): Promise<void> {
  if (!provider.isConfigured) return;
  const stale = await db
    .select()
    .from(invoices)
    .where(
      and(
        where,
        inArray(invoices.status, OPEN_STATUSES),
        isNotNull(invoices.paypalInvoiceId),
        or(isNull(invoices.syncedAt), lt(invoices.syncedAt, new Date(now.getTime() - SYNC_TTL_MS))),
      ),
    )
    .limit(limit);
  await Promise.all(
    stale.map((row) =>
      syncRow(db, row, provider, now).catch((error: unknown) => {
        console.error("Invoice status refresh failed", { invoiceId: row.id, error: (error as Error)?.name });
      }),
    ),
  );
}

/* ───────── Lists ───────── */

export interface InvoiceListRow {
  id: string;
  clientId: string;
  clientName: string;
  title: string;
  number: string | null;
  status: InvoiceStatus;
  totalCents: number;
  paidCents: number;
  currency: string;
  dueDate: string | null;
  payUrl: string | null;
  createdAt: Date;
  sentAt: Date | null;
  paidAt: Date | null;
}

const listColumns = {
  id: invoices.id,
  clientId: invoices.clientId,
  clientName: clients.displayName,
  title: invoices.title,
  number: invoices.paypalInvoiceNumber,
  status: invoices.status,
  totalCents: invoices.totalCents,
  paidCents: invoices.paidCents,
  currency: invoices.currency,
  dueDate: invoices.dueDate,
  payUrl: invoices.payUrl,
  createdAt: invoices.createdAt,
  sentAt: invoices.sentAt,
  paidAt: invoices.paidAt,
};

/** Invoices for one client (staff). */
export async function listClientInvoices(db: Db, actor: Actor, clientId: string, provider: InvoiceProvider = paypalProvider(), now = new Date()): Promise<InvoiceListRow[]> {
  requirePermission(actor, "billing", "view");
  await assertClientAccess(db, actor, clientId);
  const mine = and(inFirm(invoices.firmId, actor), eq(invoices.clientId, clientId));
  await refreshStale(db, mine, provider, now);
  return db.select(listColumns).from(invoices).innerJoin(clients, eq(clients.id, invoices.clientId)).where(mine).orderBy(desc(invoices.createdAt));
}

/** All invoices on clients the staff member can see. */
export async function listInvoices(
  db: Db,
  actor: Actor,
  opts: { status?: InvoiceStatus | "open" } = {},
  provider: InvoiceProvider = paypalProvider(),
  now = new Date(),
): Promise<InvoiceListRow[]> {
  requirePermission(actor, "billing", "view");
  const scope = and(inFirm(invoices.firmId, actor), inArray(invoices.clientId, db.select({ id: clients.id }).from(clients).where(visibleClientsCondition(db, actor))));
  await refreshStale(db, scope, provider, now, 25);
  const statusFilter = opts.status === "open" ? inArray(invoices.status, OPEN_STATUSES) : opts.status ? eq(invoices.status, opts.status) : undefined;
  return db
    .select(listColumns)
    .from(invoices)
    .innerJoin(clients, eq(clients.id, invoices.clientId))
    .where(and(scope, statusFilter))
    .orderBy(desc(invoices.createdAt))
    .limit(500);
}

export interface InvoiceTotals {
  outstandingCents: number;
  openCount: number;
  paidLast30Cents: number;
  overdueCount: number;
}

/** Headline figures from the linked copies (refreshed from PayPal on list views). */
export async function invoiceTotals(db: Db, actor: Actor, today: string, now = new Date()): Promise<InvoiceTotals> {
  requirePermission(actor, "billing", "view");
  const scope = and(inFirm(invoices.firmId, actor), inArray(invoices.clientId, db.select({ id: clients.id }).from(clients).where(visibleClientsCondition(db, actor))));
  const since = new Date(now.getTime() - 30 * 24 * 3600_000);
  const [row] = await db
    .select({
      outstanding: sql<number>`coalesce(sum(case when ${invoices.status} in ('sent','partially_paid') then ${invoices.totalCents} - ${invoices.paidCents} end), 0)::int`,
      openCount: sql<number>`count(*) filter (where ${invoices.status} in ('sent','partially_paid'))::int`,
      paid30: sql<number>`coalesce(sum(case when ${invoices.status} = 'paid' and ${invoices.paidAt} >= ${since} then ${invoices.paidCents} end), 0)::int`,
      overdue: sql<number>`count(*) filter (where ${invoices.status} in ('sent','partially_paid') and ${invoices.dueDate} < ${today})::int`,
    })
    .from(invoices)
    .where(scope);
  return { outstandingCents: row?.outstanding ?? 0, openCount: row?.openCount ?? 0, paidLast30Cents: row?.paid30 ?? 0, overdueCount: row?.overdue ?? 0 };
}

/* ───────── Client portal ───────── */

export interface PortalInvoice {
  id: string;
  title: string;
  number: string | null;
  status: InvoiceStatus;
  totalCents: number;
  paidCents: number;
  currency: string;
  dueDate: string | null;
  payUrl: string | null;
  sentAt: Date | null;
  paidAt: Date | null;
}

/** The signed-in client's own invoices. Drafts are never shown to clients. */
export async function listPortalInvoices(db: Db, actor: Actor, provider: InvoiceProvider = paypalProvider(), now = new Date()): Promise<PortalInvoice[]> {
  if (actor.role !== "client" || !actor.clientId) throw new ForbiddenError();
  const mine = and(inFirm(invoices.firmId, actor), eq(invoices.clientId, actor.clientId), ne(invoices.status, "draft"));
  await refreshStale(db, mine, provider, now);
  const rows = await db
    .select({
      id: invoices.id,
      title: invoices.title,
      number: invoices.paypalInvoiceNumber,
      status: invoices.status,
      totalCents: invoices.totalCents,
      paidCents: invoices.paidCents,
      currency: invoices.currency,
      dueDate: invoices.dueDate,
      payUrl: invoices.payUrl,
      sentAt: invoices.sentAt,
      paidAt: invoices.paidAt,
    })
    .from(invoices)
    .where(mine)
    .orderBy(desc(invoices.createdAt));
  // Only open invoices get a pay link.
  return rows.map((r) => (OPEN_STATUSES.includes(r.status) ? r : { ...r, payUrl: null }));
}

/** Count of invoices awaiting payment, for the portal tab badge. */
export async function countOpenPortalInvoices(db: Db, actor: Actor): Promise<number> {
  if (actor.role !== "client" || !actor.clientId) return 0;
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(invoices)
    .where(and(inFirm(invoices.firmId, actor), eq(invoices.clientId, actor.clientId), inArray(invoices.status, OPEN_STATUSES)));
  return row?.n ?? 0;
}
