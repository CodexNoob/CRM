import { and, desc, eq, inArray, lte } from "drizzle-orm";
import type { Db } from "@/db";
import { clients, subscriptions, type Subscription, type SubscriptionStatus } from "@/db/schema";
import type { Actor } from "@/lib/auth/actor";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { isUuid, parseInput, subscriptionInputSchema } from "@/lib/validation";
import { assertClientAccess, inFirm, requirePermission, visibleClientsCondition } from "./access";
import { recordAudit } from "./audit";
import { assertQboBillingReady } from "./invoices";

const LIVE_STATUSES: SubscriptionStatus[] = ["pending", "active", "suspended"];

function requireBillingManager(actor: Actor) {
  requirePermission(actor, "billing", "edit");
  if (!["admin", "administrator", "operations_manager", "manager", "project_manager", "finance_manager", "super_admin"].some((role) => role === actor.role)) {
    throw new ForbiddenError("Only an admin or manager can cancel invoice schedules.");
  }
}

async function loadForStaff(db: Db, actor: Actor, id: string): Promise<Subscription> {
  requirePermission(actor, "billing", "view");
  if (!isUuid(id)) throw new NotFoundError();
  const [row] = await db.select().from(subscriptions).where(and(eq(subscriptions.id, id), inFirm(subscriptions.firmId, actor))).limit(1);
  if (!row) throw new NotFoundError();
  await assertClientAccess(db, actor, row.clientId);
  return row;
}

/** Creates a local invoice schedule; invoices are issued by the secured billing job. */
export async function createSubscriptionPlan(db: Db, actor: Actor, clientId: string, input: Record<string, unknown>, now = new Date()): Promise<Subscription> {
  requirePermission(actor, "billing", "create");
  await assertClientAccess(db, actor, clientId);
  const data = parseInput(subscriptionInputSchema, input);
  const [client] = await db.select({ email: clients.email }).from(clients)
    .where(and(eq(clients.id, clientId), inFirm(clients.firmId, actor))).limit(1);
  if (!client?.email) throw new ValidationError({ _form: ["This client has no email address. Add one before setting up recurring invoices."] });
  await assertQboBillingReady(db, actor.firmId, clientId);
  const [row] = await db.insert(subscriptions).values({
    firmId: actor.firmId,
    clientId,
    name: data.name,
    amountCents: data.amountCents,
    currency: "USD",
    interval: data.interval,
    status: "active",
    nextBillingAt: now,
    createdById: actor.userId,
  }).returning();
  await recordAudit(db, { firmId: actor.firmId, actorUserId: actor.userId, action: "subscription.create", entityType: "subscription", entityId: row!.id, metadata: { clientId } });
  return row!;
}

export async function refreshSubscription(db: Db, actor: Actor, id: string): Promise<Subscription> {
  return loadForStaff(db, actor, id);
}

/** Cancelling stops future scheduled invoices. Existing invoices remain due in QuickBooks. */
export async function cancelSubscription(db: Db, actor: Actor, id: string, now = new Date()): Promise<void> {
  requireBillingManager(actor);
  const row = await loadForStaff(db, actor, id);
  if (!LIVE_STATUSES.includes(row.status)) throw new ValidationError({ _form: ["This invoice schedule has already ended."] });
  await db.update(subscriptions).set({ status: "cancelled", cancelledAt: now, updatedAt: now })
    .where(and(eq(subscriptions.id, row.id), eq(subscriptions.firmId, row.firmId)));
  await recordAudit(db, { firmId: row.firmId, actorUserId: actor.userId, action: "subscription.cancel", entityType: "subscription", entityId: row.id, metadata: { clientId: row.clientId } });
}

export interface SubscriptionRow {
  id: string;
  clientId: string;
  clientName: string;
  name: string;
  amountCents: number;
  currency: string;
  interval: "month" | "year";
  status: SubscriptionStatus;
  nextBillingAt: Date | null;
  lastPaymentAt: Date | null;
  createdAt: Date;
}

const columns = {
  id: subscriptions.id,
  clientId: subscriptions.clientId,
  clientName: clients.displayName,
  name: subscriptions.name,
  amountCents: subscriptions.amountCents,
  currency: subscriptions.currency,
  interval: subscriptions.interval,
  status: subscriptions.status,
  nextBillingAt: subscriptions.nextBillingAt,
  lastPaymentAt: subscriptions.lastPaymentAt,
  createdAt: subscriptions.createdAt,
};

export async function listClientSubscriptions(db: Db, actor: Actor, clientId: string): Promise<SubscriptionRow[]> {
  requirePermission(actor, "billing", "view");
  await assertClientAccess(db, actor, clientId);
  return db.select(columns).from(subscriptions).innerJoin(clients, eq(clients.id, subscriptions.clientId))
    .where(and(inFirm(subscriptions.firmId, actor), eq(subscriptions.clientId, clientId)))
    .orderBy(desc(subscriptions.createdAt));
}

export async function listSubscriptions(db: Db, actor: Actor): Promise<SubscriptionRow[]> {
  requirePermission(actor, "billing", "view");
  const scope = and(inFirm(subscriptions.firmId, actor), inArray(subscriptions.clientId, db.select({ id: clients.id }).from(clients).where(visibleClientsCondition(db, actor))));
  return db.select(columns).from(subscriptions).innerJoin(clients, eq(clients.id, subscriptions.clientId))
    .where(scope).orderBy(desc(subscriptions.createdAt)).limit(500);
}

export type PortalSubscription = Omit<SubscriptionRow, "clientId" | "clientName">;

const portalColumns = {
  id: subscriptions.id,
  name: subscriptions.name,
  amountCents: subscriptions.amountCents,
  currency: subscriptions.currency,
  interval: subscriptions.interval,
  status: subscriptions.status,
  nextBillingAt: subscriptions.nextBillingAt,
  lastPaymentAt: subscriptions.lastPaymentAt,
  createdAt: subscriptions.createdAt,
};

export async function listPortalSubscriptions(db: Db, actor: Actor): Promise<PortalSubscription[]> {
  if (actor.role !== "client" || !actor.clientId) throw new ForbiddenError();
  return db.select(portalColumns).from(subscriptions)
    .where(and(inFirm(subscriptions.firmId, actor), eq(subscriptions.clientId, actor.clientId)))
    .orderBy(desc(subscriptions.createdAt));
}

export async function listDueSubscriptions(db: Db, now = new Date(), limit = 25): Promise<Subscription[]> {
  return db.select().from(subscriptions).where(and(
    eq(subscriptions.status, "active"),
    lte(subscriptions.nextBillingAt, now),
    eq(subscriptions.legacyBilling, false),
  )).orderBy(subscriptions.nextBillingAt).limit(limit);
}
