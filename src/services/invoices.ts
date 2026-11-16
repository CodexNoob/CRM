import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNotNull, isNull, lt, ne, or, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { clients, engagements, invoices, qboCustomerLinks, subscriptions, type Invoice, type InvoiceStatus, type Subscription } from "@/db/schema";
import { createInvoice as createQboInvoice, getInvoice as getQboInvoice, sendInvoice as sendQboInvoice, voidInvoice as voidQboInvoice, type QboInvoiceSnapshot } from "@/integrations/qbo";
import { isManagerOrAdmin, type Actor } from "@/lib/auth/actor";
import { AppError, ForbiddenError, IntegrationNotConfiguredError, NotFoundError, ValidationError } from "@/lib/errors";
import { isUuid, parseInvoiceInput } from "@/lib/validation";
import { assertClientAccess, inFirm, requirePermission, visibleClientsCondition } from "./access";
import { recordAudit } from "./audit";
import { getQboAccessToken, qboFirmFinancialActionsEnabled } from "./qbo-connections";

const OPEN_STATUSES: InvoiceStatus[] = ["sent", "partially_paid"];
const SYNC_TTL_MS = 2 * 60 * 1000;

export function mapQboInvoiceStatus(snapshot: QboInvoiceSnapshot): InvoiceStatus {
  switch (snapshot.status) {
    case "paid": return "paid";
    case "partially_paid": return "partially_paid";
    case "voided": return "cancelled";
    default: return "sent";
  }
}

function qboFailure(action: string, error: unknown): AppError {
  if (error instanceof AppError) return error;
  const reason = error instanceof Error ? error.message : "the request did not complete";
  return new AppError(`QuickBooks could not ${action}: ${reason}`);
}

function requireFinancialActions() {
  if (!qboFirmFinancialActionsEnabled()) {
    throw new IntegrationNotConfiguredError("QuickBooks Online", "Firm financial actions are disabled. Verify the sandbox invoice and payment workflow before setting QBO_FIRM_FINANCIAL_ACTIONS_ENABLED=1.");
  }
}

function snapshotPatch(snapshot: QboInvoiceSnapshot, now: Date) {
  return {
    status: mapQboInvoiceStatus(snapshot),
    qboInvoiceNumber: snapshot.number,
    payUrl: snapshot.invoiceUrl,
    paidCents: snapshot.totalCents - snapshot.balanceCents,
    syncedAt: now,
    updatedAt: now,
  };
}

async function loadForStaff(db: Db, actor: Actor, id: string): Promise<Invoice> {
  requirePermission(actor, "billing", "view");
  if (!isUuid(id)) throw new NotFoundError();
  const [row] = await db.select().from(invoices).where(and(eq(invoices.id, id), inFirm(invoices.firmId, actor))).limit(1);
  if (!row) throw new NotFoundError();
  await assertClientAccess(db, actor, row.clientId);
  return row;
}

async function qboContext(db: Db, firmId: string, clientId: string) {
  const connection = await getQboAccessToken(db, { type: "firm", firmId });
  if (!connection.defaultItemId) throw new IntegrationNotConfiguredError("QuickBooks Online", "An administrator must select an active QuickBooks service item in Integrations.");
  const [link] = await db.select({ customerId: qboCustomerLinks.qboCustomerId })
    .from(qboCustomerLinks)
    .where(and(
      eq(qboCustomerLinks.connectionId, connection.connectionId),
      eq(qboCustomerLinks.firmId, firmId),
      eq(qboCustomerLinks.clientId, clientId),
    )).limit(1);
  if (!link) throw new IntegrationNotConfiguredError("QuickBooks Online", "An administrator must match this client to an existing QuickBooks customer before billing.");
  return { ...connection, customerId: link.customerId, itemId: connection.defaultItemId };
}

async function createRemoteInvoice(db: Db, firmId: string, row: Invoice): Promise<Invoice> {
  const context = await qboContext(db, row.firmId, row.clientId);
  const [client] = await db.select({ email: clients.email }).from(clients)
    .where(and(eq(clients.id, row.clientId), eq(clients.firmId, firmId))).limit(1);
  if (!client?.email) throw new ValidationError({ _form: ["This client has no email address. Add one before sending the invoice."] });
  const requestId = row.qboRequestId ?? randomUUID();
  if (!row.qboRequestId) {
    await db.update(invoices).set({ qboRequestId: requestId, updatedAt: new Date() })
      .where(and(eq(invoices.id, row.id), eq(invoices.firmId, row.firmId), isNull(invoices.qboRequestId)));
  }
  const snapshot = await createQboInvoice(context.accessToken, context.realmId, {
    customerId: context.customerId,
    itemId: context.itemId,
    email: client.email,
    currency: row.currency,
    dueDate: row.dueDate,
    note: [row.title, row.note].filter(Boolean).join("\n\n"),
    items: row.items,
  }, requestId);
  const [updated] = await db.update(invoices).set({
    qboInvoiceId: snapshot.id,
    qboInvoiceNumber: snapshot.number,
    payUrl: snapshot.invoiceUrl,
    syncedAt: new Date(),
    updatedAt: new Date(),
  }).where(and(eq(invoices.id, row.id), eq(invoices.firmId, row.firmId))).returning();
  return updated!;
}

async function sendDraftInternal(db: Db, firmId: string, userId: string | null, input: Invoice, now: Date): Promise<Invoice> {
  requireFinancialActions();
  if (input.status !== "draft" || input.legacyBilling) throw new ValidationError({ _form: ["Only a new QuickBooks draft can be sent. Legacy billing records cannot be sent again."] });
  try {
    let row = input;
    if (!row.qboInvoiceId) row = await createRemoteInvoice(db, firmId, row);
    const context = await qboContext(db, firmId, row.clientId);
    const [client] = await db.select({ email: clients.email }).from(clients)
      .where(and(eq(clients.id, row.clientId), eq(clients.firmId, firmId))).limit(1);
    if (!client?.email) throw new ValidationError({ _form: ["This client has no email address. Add one before sending the invoice."] });
    const snapshot = await sendQboInvoice(context.accessToken, context.realmId, row.qboInvoiceId!, client.email);
    const [updated] = await db.update(invoices).set({
      ...snapshotPatch(snapshot, now),
      sentAt: now,
    }).where(and(eq(invoices.id, row.id), eq(invoices.firmId, row.firmId))).returning();
    await recordAudit(db, { firmId: row.firmId, actorUserId: userId, action: "invoice.send", entityType: "invoice", entityId: row.id, metadata: { clientId: row.clientId } });
    return updated!;
  } catch (error) {
    const failure = qboFailure("create or send the invoice", error);
    throw new AppError(`${failure.message} The invoice remains a draft; correct the issue and choose “Send” to retry.`);
  }
}

/** Creates an idempotent local invoice record before contacting QuickBooks. */
export async function createInvoice(db: Db, actor: Actor, clientId: string, input: Record<string, unknown>, now = new Date()): Promise<Invoice> {
  requirePermission(actor, "billing", "create");
  requireFinancialActions();
  await assertClientAccess(db, actor, clientId);
  const data = parseInvoiceInput(input);
  const [client] = await db.select({ email: clients.email }).from(clients)
    .where(and(eq(clients.id, clientId), inFirm(clients.firmId, actor))).limit(1);
  if (!client?.email) throw new ValidationError({ _form: ["This client has no email address. Add one before sending the invoice."] });
  if (data.engagementId) {
    const [engagement] = await db.select({ id: engagements.id }).from(engagements)
      .where(and(eq(engagements.id, data.engagementId), eq(engagements.clientId, clientId), inFirm(engagements.firmId, actor))).limit(1);
    if (!engagement) throw new ValidationError({ engagementId: ["Choose one of this client’s engagements."] });
  }
  await qboContext(db, actor.firmId, clientId);
  const submittedRequestId = input.requestId;
  if (submittedRequestId !== undefined && (typeof submittedRequestId !== "string" || !isUuid(submittedRequestId))) {
    throw new ValidationError({ requestId: ["This invoice form has expired. Reload the page and try again."] });
  }
  const requestId = typeof submittedRequestId === "string" ? submittedRequestId : randomUUID();
  const [existing] = await db.select().from(invoices)
    .where(and(eq(invoices.firmId, actor.firmId), eq(invoices.qboRequestId, requestId))).limit(1);
  if (existing) {
    if (existing.clientId !== clientId || existing.title !== data.title || existing.totalCents !== data.totalCents ||
        JSON.stringify(existing.items) !== JSON.stringify(data.items)) {
      throw new ValidationError({ _form: ["This invoice submission key was already used for different invoice details. Reload the form before trying again."] });
    }
    return existing.status === "draft" ? sendDraftInternal(db, actor.firmId, actor.userId, existing, now) : existing;
  }
  const [row] = await db.insert(invoices).values({
    firmId: actor.firmId,
    clientId,
    engagementId: data.engagementId ?? null,
    title: data.title,
    items: data.items,
    currency: "USD",
    totalCents: data.totalCents,
    dueDate: data.dueDate ?? null,
    note: data.note ?? null,
    recipientEmail: client.email,
    qboRequestId: requestId,
    createdById: actor.userId,
    createdAt: now,
    updatedAt: now,
  }).returning();
  await recordAudit(db, { firmId: actor.firmId, actorUserId: actor.userId, action: "invoice.create", entityType: "invoice", entityId: row!.id, metadata: { clientId } });
  return sendDraftInternal(db, actor.firmId, actor.userId, row!, now);
}

export async function sendInvoice(db: Db, actor: Actor, id: string, now = new Date()): Promise<Invoice> {
  requirePermission(actor, "billing", "edit");
  return sendDraftInternal(db, actor.firmId, actor.userId, await loadForStaff(db, actor, id), now);
}

function nextScheduleDate(from: Date, interval: "month" | "year"): Date {
  const next = new Date(from);
  if (interval === "month") {
    const day = next.getUTCDate();
    next.setUTCDate(1);
    next.setUTCMonth(next.getUTCMonth() + 1);
    const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
    next.setUTCDate(Math.min(day, lastDay));
  } else {
    next.setUTCFullYear(next.getUTCFullYear() + 1);
  }
  return next;
}

/** Issues one scheduled invoice using the subscription-period unique key and QBO RequestID. */
export async function issueScheduledInvoice(db: Db, subscription: Subscription, now = new Date()): Promise<Invoice> {
  requireFinancialActions();
  const scheduledAt = subscription.nextBillingAt;
  if (subscription.status !== "active" || !scheduledAt || scheduledAt > now || subscription.legacyBilling) {
    throw new ValidationError({ _form: ["This recurring invoice is not due."] });
  }
  const periodStart = scheduledAt.toISOString().slice(0, 10);
  await qboContext(db, subscription.firmId, subscription.clientId);
  const [client] = await db.select({ email: clients.email }).from(clients)
    .where(and(eq(clients.id, subscription.clientId), eq(clients.firmId, subscription.firmId))).limit(1);
  if (!client?.email) throw new ValidationError({ _form: ["The client needs an email address before a recurring invoice can be sent."] });
  await db.insert(invoices).values({
    firmId: subscription.firmId,
    clientId: subscription.clientId,
    title: subscription.name,
    items: [{ name: subscription.name, quantity: 1, unitCents: subscription.amountCents }],
    currency: subscription.currency,
    totalCents: subscription.amountCents,
    recipientEmail: client.email,
    subscriptionId: subscription.id,
    billingPeriodStart: periodStart,
    qboRequestId: randomUUID(),
    createdById: subscription.createdById,
  }).onConflictDoNothing();
  const [row] = await db.select().from(invoices)
    .where(and(eq(invoices.subscriptionId, subscription.id), eq(invoices.billingPeriodStart, periodStart))).limit(1);
  if (!row) throw new AppError("The scheduled QuickBooks invoice could not be saved.");
  const sent = row.status === "draft"
    ? await sendDraftInternal(db, subscription.firmId, subscription.createdById, row, now)
    : row;
  await db.update(subscriptions).set({
    nextBillingAt: nextScheduleDate(scheduledAt, subscription.interval),
    updatedAt: now,
  }).where(and(
    eq(subscriptions.id, subscription.id),
    eq(subscriptions.firmId, subscription.firmId),
    eq(subscriptions.nextBillingAt, scheduledAt),
  ));
  return sent;
}

function requireBillingManager(actor: Actor) {
  requirePermission(actor, "billing", "edit");
  if (!isManagerOrAdmin(actor)) throw new ForbiddenError("Only an admin or manager can cancel invoices.");
}

export async function cancelInvoice(db: Db, actor: Actor, id: string, now = new Date()): Promise<void> {
  requireBillingManager(actor);
  requireFinancialActions();
  const row = await loadForStaff(db, actor, id);
  if (row.legacyBilling || !["draft", "sent", "partially_paid"].includes(row.status)) {
    throw new ValidationError({ _form: ["Only an unpaid QuickBooks invoice can be voided. Payments and refunds must be handled in QuickBooks."] });
  }
  if (row.qboInvoiceId) {
    try {
      const context = await getQboAccessToken(db, { type: "firm", firmId: row.firmId });
      await voidQboInvoice(context.accessToken, context.realmId, row.qboInvoiceId);
    } catch (error) {
      throw qboFailure("void the invoice", error);
    }
  }
  await db.update(invoices).set({ status: "cancelled", payUrl: null, syncedAt: now, updatedAt: now })
    .where(and(eq(invoices.id, row.id), eq(invoices.firmId, row.firmId)));
  await recordAudit(db, { firmId: row.firmId, actorUserId: actor.userId, action: "invoice.cancel", entityType: "invoice", entityId: row.id, metadata: { clientId: row.clientId } });
}

async function syncRow(db: Db, row: Invoice, now: Date): Promise<Invoice> {
  if (!row.qboInvoiceId || row.legacyBilling) return row;
  const context = await getQboAccessToken(db, { type: "firm", firmId: row.firmId });
  const snapshot = await getQboInvoice(context.accessToken, context.realmId, row.qboInvoiceId);
  const patch = snapshotPatch(snapshot, now);
  const becamePaid = patch.status === "paid" && row.status !== "paid";
  const [updated] = await db.update(invoices).set({ ...patch, ...(becamePaid ? { paidAt: now } : {}) })
    .where(and(eq(invoices.id, row.id), eq(invoices.firmId, row.firmId))).returning();
  if (becamePaid) await recordAudit(db, { firmId: row.firmId, actorUserId: null, action: "invoice.paid", entityType: "invoice", entityId: row.id, metadata: { clientId: row.clientId } });
  if (becamePaid && row.subscriptionId) {
    await db.update(subscriptions).set({ lastPaymentAt: now, lastPaymentCents: patch.paidCents, updatedAt: now })
      .where(and(eq(subscriptions.id, row.subscriptionId), eq(subscriptions.firmId, row.firmId)));
  }
  return updated!;
}

export async function refreshInvoice(db: Db, actor: Actor, id: string, now = new Date()): Promise<Invoice> {
  requirePermission(actor, "billing", "view");
  const row = await loadForStaff(db, actor, id);
  try {
    return await syncRow(db, row, now);
  } catch (error) {
    throw qboFailure("load the invoice status", error);
  }
}

async function refreshStale(db: Db, where: ReturnType<typeof and>, now: Date, limit = 15): Promise<void> {
  if (!qboFirmFinancialActionsEnabled()) return;
  const stale = await db.select().from(invoices).where(and(
    where,
    inArray(invoices.status, OPEN_STATUSES),
    isNotNull(invoices.qboInvoiceId),
    eq(invoices.legacyBilling, false),
    or(isNull(invoices.syncedAt), lt(invoices.syncedAt, new Date(now.getTime() - SYNC_TTL_MS))),
  )).limit(limit);
  await Promise.all(stale.map((row) => syncRow(db, row, now).catch((error: unknown) => {
    console.error("QuickBooks invoice refresh failed", { invoiceId: row.id, error: error instanceof Error ? error.name : "UnknownError" });
  })));
}

export interface InvoiceListRow {
  id: string; clientId: string; clientName: string; title: string; number: string | null;
  status: InvoiceStatus; totalCents: number; paidCents: number; currency: string; dueDate: string | null;
  payUrl: string | null; createdAt: Date; sentAt: Date | null; paidAt: Date | null;
}

const listColumns = {
  id: invoices.id, clientId: invoices.clientId, clientName: clients.displayName, title: invoices.title,
  number: invoices.qboInvoiceNumber, status: invoices.status, totalCents: invoices.totalCents,
  paidCents: invoices.paidCents, currency: invoices.currency, dueDate: invoices.dueDate, payUrl: invoices.payUrl,
  createdAt: invoices.createdAt, sentAt: invoices.sentAt, paidAt: invoices.paidAt,
};

export async function listClientInvoices(db: Db, actor: Actor, clientId: string, now = new Date()): Promise<InvoiceListRow[]> {
  requirePermission(actor, "billing", "view");
  await assertClientAccess(db, actor, clientId);
  const mine = and(inFirm(invoices.firmId, actor), eq(invoices.clientId, clientId));
  await refreshStale(db, mine, now);
  return db.select(listColumns).from(invoices).innerJoin(clients, eq(clients.id, invoices.clientId)).where(mine).orderBy(desc(invoices.createdAt));
}

export async function listInvoices(db: Db, actor: Actor, opts: { status?: InvoiceStatus | "open" } = {}, now = new Date()): Promise<InvoiceListRow[]> {
  requirePermission(actor, "billing", "view");
  const scope = and(inFirm(invoices.firmId, actor), inArray(invoices.clientId, db.select({ id: clients.id }).from(clients).where(visibleClientsCondition(db, actor))));
  await refreshStale(db, scope, now, 25);
  const filter = opts.status === "open" ? inArray(invoices.status, OPEN_STATUSES) : opts.status ? eq(invoices.status, opts.status) : undefined;
  return db.select(listColumns).from(invoices).innerJoin(clients, eq(clients.id, invoices.clientId))
    .where(and(scope, filter)).orderBy(desc(invoices.createdAt)).limit(500);
}

export interface InvoiceTotals { outstandingCents: number; openCount: number; paidLast30Cents: number; overdueCount: number }

export async function invoiceTotals(db: Db, actor: Actor, today: string, now = new Date()): Promise<InvoiceTotals> {
  requirePermission(actor, "billing", "view");
  const scope = and(inFirm(invoices.firmId, actor), inArray(invoices.clientId, db.select({ id: clients.id }).from(clients).where(visibleClientsCondition(db, actor))));
  const since = new Date(now.getTime() - 30 * 24 * 3600_000);
  const [row] = await db.select({
    outstanding: sql<number>`coalesce(sum(case when ${invoices.status} in ('sent','partially_paid') then ${invoices.totalCents} - ${invoices.paidCents} end), 0)::int`,
    openCount: sql<number>`count(*) filter (where ${invoices.status} in ('sent','partially_paid'))::int`,
    paid30: sql<number>`coalesce(sum(case when ${invoices.status} = 'paid' and ${invoices.paidAt} >= ${since} then ${invoices.paidCents} end), 0)::int`,
    overdue: sql<number>`count(*) filter (where ${invoices.status} in ('sent','partially_paid') and ${invoices.dueDate} < ${today})::int`,
  }).from(invoices).where(scope);
  return { outstandingCents: row?.outstanding ?? 0, openCount: row?.openCount ?? 0, paidLast30Cents: row?.paid30 ?? 0, overdueCount: row?.overdue ?? 0 };
}

export interface PortalInvoice {
  id: string; title: string; number: string | null; status: InvoiceStatus; totalCents: number; paidCents: number;
  currency: string; dueDate: string | null; payUrl: string | null; sentAt: Date | null; paidAt: Date | null;
}

export async function listPortalInvoices(db: Db, actor: Actor, now = new Date()): Promise<PortalInvoice[]> {
  if (actor.role !== "client" || !actor.clientId) throw new ForbiddenError();
  const mine = and(inFirm(invoices.firmId, actor), eq(invoices.clientId, actor.clientId), ne(invoices.status, "draft"));
  await refreshStale(db, mine, now);
  const rows = await db.select({
    id: invoices.id, title: invoices.title, number: invoices.qboInvoiceNumber, status: invoices.status,
    totalCents: invoices.totalCents, paidCents: invoices.paidCents, currency: invoices.currency,
    dueDate: invoices.dueDate, payUrl: invoices.payUrl, sentAt: invoices.sentAt, paidAt: invoices.paidAt,
  }).from(invoices).where(mine).orderBy(desc(invoices.createdAt));
  return rows.map((row) => OPEN_STATUSES.includes(row.status) && !row.status.includes("cancelled") ? row : { ...row, payUrl: null });
}

export async function countOpenPortalInvoices(db: Db, actor: Actor): Promise<number> {
  if (actor.role !== "client" || !actor.clientId) return 0;
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(invoices)
    .where(and(inFirm(invoices.firmId, actor), eq(invoices.clientId, actor.clientId), inArray(invoices.status, OPEN_STATUSES)));
  return row?.n ?? 0;
}

export async function assertQboBillingReady(db: Db, firmId: string, clientId: string): Promise<void> {
  requireFinancialActions();
  await qboContext(db, firmId, clientId);
}
