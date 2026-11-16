import { and, desc, eq, inArray, isNotNull, isNull, lt, or } from "drizzle-orm";
import type { Db } from "@/db";
import { clients, subscriptions, type Subscription, type SubscriptionStatus } from "@/db/schema";
import * as paypal from "@/integrations/paypal";
import type { PayPalSubscriptionSnapshot, PayPalSubscriptionStatus } from "@/integrations/paypal";
import { isManagerOrAdmin, type Actor } from "@/lib/auth/actor";
import { ForbiddenError, IntegrationNotConfiguredError, NotFoundError, ValidationError } from "@/lib/errors";
import { isUuid, parseInput, subscriptionInputSchema } from "@/lib/validation";
import { assertClientAccess, inFirm, requirePermission, visibleClientsCondition } from "./access";
import { recordAudit } from "./audit";
import { paypalFailure } from "./invoices";

/**
 * Recurring billing through PayPal Subscriptions. Staff create a plan for a client
 * (amount + monthly/yearly). The client clicks "Subscribe" in the portal, approves it in
 * PayPal, and PayPal then charges them automatically each period. The CRM keeps a linked
 * copy and refreshes its status from PayPal.
 */

export interface SubscriptionProvider {
  readonly isConfigured: boolean;
  readonly currency: string;
  createPlan: typeof paypal.createPlan;
  startSubscription: typeof paypal.startSubscription;
  getSubscription: typeof paypal.getSubscription;
  cancelSubscription: typeof paypal.cancelSubscription;
}

export function paypalSubscriptions(): SubscriptionProvider {
  const cfg = paypal.paypalConfig();
  return {
    isConfigured: cfg.isConfigured,
    currency: cfg.currency,
    createPlan: paypal.createPlan,
    startSubscription: paypal.startSubscription,
    getSubscription: paypal.getSubscription,
    cancelSubscription: paypal.cancelSubscription,
  };
}

const SYNC_TTL_MS = 2 * 60 * 1000;
const LIVE_STATUSES: SubscriptionStatus[] = ["pending", "active", "suspended"];

export function mapSubscriptionStatus(s: PayPalSubscriptionStatus): SubscriptionStatus {
  switch (s) {
    case "ACTIVE":
      return "active";
    case "SUSPENDED":
      return "suspended";
    case "CANCELLED":
      return "cancelled";
    case "EXPIRED":
      return "expired";
    default:
      return "pending"; // APPROVAL_PENDING, APPROVED (activates shortly)
  }
}

function requireConfigured(p: SubscriptionProvider) {
  if (!p.isConfigured) throw new IntegrationNotConfiguredError("PayPal", "add PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET to the server settings.");
}

function patchFrom(snap: PayPalSubscriptionSnapshot, row: Subscription, now: Date) {
  const status = mapSubscriptionStatus(snap.status);
  return {
    status,
    nextBillingAt: snap.nextBillingAt,
    lastPaymentAt: snap.lastPaymentAt,
    lastPaymentCents: snap.lastPaymentCents,
    ...(status === "active" && !row.activatedAt ? { activatedAt: now } : {}),
    ...((status === "cancelled" || status === "expired") && !row.cancelledAt ? { cancelledAt: now } : {}),
    syncedAt: now,
    updatedAt: now,
  };
}

async function syncRow(db: Db, row: Subscription, p: SubscriptionProvider, now: Date): Promise<Subscription> {
  if (!row.paypalSubscriptionId) return row;
  const snap = await p.getSubscription(row.paypalSubscriptionId);
  // A checkout the client walked away from stays APPROVAL_PENDING → "pending", so they can start again.
  const patch = patchFrom(snap, row, now);
  const [updated] = await db.update(subscriptions).set(patch).where(and(eq(subscriptions.id, row.id), eq(subscriptions.firmId, row.firmId))).returning();
  if (patch.status === "active" && row.status !== "active") {
    await recordAudit(db, { firmId: row.firmId, actorUserId: null, action: "subscription.activate", entityType: "subscription", entityId: row.id, metadata: { clientId: row.clientId } });
  }
  return updated!;
}

async function refreshStale(db: Db, where: ReturnType<typeof and>, p: SubscriptionProvider, now: Date) {
  if (!p.isConfigured) return;
  const stale = await db
    .select()
    .from(subscriptions)
    .where(
      and(
        where,
        inArray(subscriptions.status, LIVE_STATUSES),
        isNotNull(subscriptions.paypalSubscriptionId),
        or(isNull(subscriptions.syncedAt), lt(subscriptions.syncedAt, new Date(now.getTime() - SYNC_TTL_MS))),
      ),
    )
    .limit(15);
  await Promise.all(
    stale.map((row) =>
      syncRow(db, row, p, now).catch((error: unknown) => console.error("Subscription status refresh failed", { subscriptionId: row.id, error: (error as Error)?.name })),
    ),
  );
}

/* ───────── Staff ───────── */

export async function createSubscriptionPlan(db: Db, actor: Actor, clientId: string, input: Record<string, unknown>, p: SubscriptionProvider = paypalSubscriptions()): Promise<Subscription> {
  requirePermission(actor, "billing", "create");
  await assertClientAccess(db, actor, clientId);
  const data = parseInput(subscriptionInputSchema, input);
  const [client] = await db.select({ email: clients.email }).from(clients).where(and(eq(clients.id, clientId), inFirm(clients.firmId, actor)));
  if (!client?.email) throw new ValidationError({ _form: ["This client has no email address. Add one on the client’s details first."] });
  requireConfigured(p);
  let planId: string;
  try {
    ({ planId } = await p.createPlan({ name: data.name, amountCents: data.amountCents, currency: p.currency, interval: data.interval }));
  } catch (error) {
    throw paypalFailure("create the subscription plan", error);
  }
  const [row] = await db
    .insert(subscriptions)
    .values({ firmId: actor.firmId, clientId, name: data.name, amountCents: data.amountCents, currency: p.currency, interval: data.interval, paypalPlanId: planId, createdById: actor.userId })
    .returning();
  await recordAudit(db, { firmId: actor.firmId, actorUserId: actor.userId, action: "subscription.create", entityType: "subscription", entityId: row!.id, metadata: { clientId } });
  return row!;
}

async function loadForStaff(db: Db, actor: Actor, id: string): Promise<Subscription> {
  requirePermission(actor, "billing", "view");
  if (!isUuid(id)) throw new NotFoundError();
  const [row] = await db.select().from(subscriptions).where(and(eq(subscriptions.id, id), inFirm(subscriptions.firmId, actor)));
  if (!row) throw new NotFoundError();
  await assertClientAccess(db, actor, row.clientId);
  return row;
}

export async function refreshSubscription(db: Db, actor: Actor, id: string, p: SubscriptionProvider = paypalSubscriptions(), now = new Date()): Promise<Subscription> {
  const row = await loadForStaff(db, actor, id);
  requireConfigured(p);
  try {
    return await syncRow(db, row, p, now);
  } catch (error) {
    throw paypalFailure("load the subscription", error);
  }
}

/** Stops future charges. Admin/partner only (billing correction). */
export async function cancelSubscription(db: Db, actor: Actor, id: string, p: SubscriptionProvider = paypalSubscriptions(), now = new Date()): Promise<void> {
  requirePermission(actor, "billing", "edit");
  if (!isManagerOrAdmin(actor)) throw new ForbiddenError("Only an admin or manager can cancel subscriptions.");
  const row = await loadForStaff(db, actor, id);
  if (!LIVE_STATUSES.includes(row.status)) throw new ValidationError({ _form: ["This subscription has already ended."] });
  requireConfigured(p);
  if (row.paypalSubscriptionId && row.status !== "pending") {
    try {
      await p.cancelSubscription(row.paypalSubscriptionId, "Cancelled by the firm");
    } catch (error) {
      throw paypalFailure("cancel the subscription", error);
    }
  }
  await db.update(subscriptions).set({ status: "cancelled", cancelledAt: now, syncedAt: now, updatedAt: now }).where(and(eq(subscriptions.id, row.id), eq(subscriptions.firmId, row.firmId)));
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

const cols = {
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

export async function listClientSubscriptions(db: Db, actor: Actor, clientId: string, p: SubscriptionProvider = paypalSubscriptions(), now = new Date()): Promise<SubscriptionRow[]> {
  requirePermission(actor, "billing", "view");
  await assertClientAccess(db, actor, clientId);
  const mine = and(inFirm(subscriptions.firmId, actor), eq(subscriptions.clientId, clientId));
  await refreshStale(db, mine, p, now);
  return db.select(cols).from(subscriptions).innerJoin(clients, eq(clients.id, subscriptions.clientId)).where(mine).orderBy(desc(subscriptions.createdAt));
}

export async function listSubscriptions(db: Db, actor: Actor, p: SubscriptionProvider = paypalSubscriptions(), now = new Date()): Promise<SubscriptionRow[]> {
  requirePermission(actor, "billing", "view");
  const scope = and(inFirm(subscriptions.firmId, actor), inArray(subscriptions.clientId, db.select({ id: clients.id }).from(clients).where(visibleClientsCondition(db, actor))));
  await refreshStale(db, scope, p, now);
  return db.select(cols).from(subscriptions).innerJoin(clients, eq(clients.id, subscriptions.clientId)).where(scope).orderBy(desc(subscriptions.createdAt)).limit(500);
}

/* ───────── Client portal ───────── */

export type PortalSubscription = Omit<SubscriptionRow, "clientId" | "clientName">;

export async function listPortalSubscriptions(db: Db, actor: Actor, p: SubscriptionProvider = paypalSubscriptions(), now = new Date()): Promise<PortalSubscription[]> {
  if (actor.role !== "client" || !actor.clientId) throw new ForbiddenError();
  const mine = and(inFirm(subscriptions.firmId, actor), eq(subscriptions.clientId, actor.clientId));
  await refreshStale(db, mine, p, now);
  const { clientId: _c, clientName: _n, ...portalCols } = cols;
  void _c;
  void _n;
  return db.select(portalCols).from(subscriptions).where(mine).orderBy(desc(subscriptions.createdAt));
}

/**
 * The portal's "Subscribe" button. Starts a fresh PayPal checkout for the client's own
 * pending plan and returns the PayPal approval URL to redirect to.
 */
export async function startPortalSubscription(
  db: Db,
  actor: Actor,
  id: string,
  urls: { returnUrl: string; cancelUrl: string; brandName: string },
  p: SubscriptionProvider = paypalSubscriptions(),
  now = new Date(),
): Promise<string> {
  if (actor.role !== "client" || !actor.clientId) throw new ForbiddenError();
  if (!isUuid(id)) throw new NotFoundError();
  const [row] = await db.select().from(subscriptions).where(and(eq(subscriptions.id, id), inFirm(subscriptions.firmId, actor), eq(subscriptions.clientId, actor.clientId)));
  if (!row) throw new NotFoundError();
  if (row.status !== "pending") throw new ValidationError({ _form: ["This subscription is already set up."] });
  requireConfigured(p);

  // If an earlier checkout was actually completed, don't start a second one.
  if (row.paypalSubscriptionId) {
    const synced = await syncRow(db, row, p, now).catch(() => row);
    if (synced.status !== "pending") throw new ValidationError({ _form: ["This subscription is already set up."] });
  }

  let snap: PayPalSubscriptionSnapshot;
  try {
    snap = await p.startSubscription({ planId: row.paypalPlanId, subscriberName: actor.name, subscriberEmail: actor.email, ...urls });
  } catch (error) {
    throw paypalFailure("start the subscription", error);
  }
  if (!snap.approveUrl) throw new ValidationError({ _form: ["PayPal didn’t return a checkout link. Please try again."] });
  await db.update(subscriptions).set({ paypalSubscriptionId: snap.id, syncedAt: now, updatedAt: now }).where(and(eq(subscriptions.id, row.id), eq(subscriptions.firmId, row.firmId)));
  await recordAudit(db, { firmId: row.firmId, actorUserId: actor.userId, action: "subscription.checkout", entityType: "subscription", entityId: row.id, metadata: { clientId: row.clientId } });
  return snap.approveUrl;
}
