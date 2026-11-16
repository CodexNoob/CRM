import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { firms, platformPlans, type Firm } from "@/db/schema";
import { product, type PlanInterval } from "@/content/product";
import type { PayPalSubscriptionStatus } from "@/integrations/paypal";
import type { Actor } from "@/lib/auth/actor";
import { ForbiddenError, IntegrationNotConfiguredError, ValidationError } from "@/lib/errors";
import { recordAudit } from "./audit";
import { getFirm } from "./firms";
import { paypalFailure } from "./invoices";
import { getPlatformProfile } from "./settings";
import { paypalSubscriptions, type SubscriptionProvider } from "./subscriptions";

/**
 * The firm's subscription to THIS SOFTWARE (paid to the operator through PayPal).
 * Not to be confused with services/subscriptions.ts, where a firm bills its own clients.
 *
 * Access rule: trial (until trial_ends_at) and active firms have full access. past_due
 * (PayPal is retrying a failed payment) keeps access with a warning. An expired trial or a
 * cancelled subscription locks the staff workspace to the Subscription page only; no data
 * is deleted and the firm's clients keep their portal.
 */

export type AccessState = "trial" | "active" | "past_due" | "locked";

export interface FirmAccess {
  state: AccessState;
  locked: boolean;
  /** Whole days left in the trial (trial only). */
  trialDaysLeft: number | null;
  reason: string | null;
}

const DAY = 24 * 3600_000;
const SYNC_TTL_MS = 2 * 60 * 1000;

export function firmAccess(firm: Pick<Firm, "status" | "trialEndsAt" | "nextBillingAt">, now = new Date()): FirmAccess {
  switch (firm.status) {
    case "active":
      return { state: "active", locked: false, trialDaysLeft: null, reason: null };
    case "past_due":
      return { state: "past_due", locked: false, trialDaysLeft: null, reason: "PayPal couldn’t take the last payment and will retry. Update the payment method in PayPal to avoid interruption." };
    case "cancelled":
      // Paid time already covered stays usable until the period ends.
      if (firm.nextBillingAt && firm.nextBillingAt.getTime() > now.getTime()) return { state: "active", locked: false, trialDaysLeft: null, reason: null };
      return { state: "locked", locked: true, trialDaysLeft: null, reason: "Your subscription has ended. Subscribe again to keep using the CRM — all your data is still here." };
    case "trial":
    default: {
      const ends = firm.trialEndsAt?.getTime();
      if (ends === undefined) return { state: "trial", locked: false, trialDaysLeft: null, reason: null };
      if (now.getTime() >= ends) {
        return { state: "locked", locked: true, trialDaysLeft: 0, reason: "Your free trial has ended. Subscribe to keep using the CRM — all your data is still here." };
      }
      return { state: "trial", locked: false, trialDaysLeft: Math.max(1, Math.ceil((ends - now.getTime()) / DAY)), reason: null };
    }
  }
}

export function trialEndsAt(now = new Date()): Date {
  return new Date(now.getTime() + product.trialDays * DAY);
}

function requireFirmAdmin(actor: Actor) {
  if (actor.role !== "admin") throw new ForbiddenError("Only a firm admin can manage the subscription.");
}

function mapStatus(s: PayPalSubscriptionStatus): Firm["status"] | null {
  switch (s) {
    case "ACTIVE":
      return "active";
    case "SUSPENDED":
      return "past_due";
    case "CANCELLED":
    case "EXPIRED":
      return "cancelled";
    default:
      return null; // APPROVAL_PENDING / APPROVED: no change yet
  }
}

/** The operator's PayPal plan for an interval, created once and remembered. */
async function planFor(db: Db, interval: PlanInterval, p: SubscriptionProvider): Promise<string> {
  const plan = product.plans[interval];
  const [existing] = await db.select().from(platformPlans).where(eq(platformPlans.interval, interval));
  if (existing && existing.amountCents === plan.amountCents && existing.currency === product.currency) return existing.paypalPlanId;
  const platform = await getPlatformProfile(db);
  const { planId } = await p.createPlan({ name: `${platform.name} — ${plan.label}`, amountCents: plan.amountCents, currency: product.currency, interval });
  await db
    .insert(platformPlans)
    .values({ interval, amountCents: plan.amountCents, currency: product.currency, paypalPlanId: planId })
    .onConflictDoUpdate({ target: platformPlans.interval, set: { amountCents: plan.amountCents, currency: product.currency, paypalPlanId: planId, createdAt: new Date() } });
  return planId;
}

/** Starts PayPal checkout for the actor's firm. Returns the PayPal approval URL. */
export async function startFirmCheckout(
  db: Db,
  actor: Actor,
  interval: unknown,
  urls: { returnUrl: string; cancelUrl: string },
  p: SubscriptionProvider = paypalSubscriptions(),
  now = new Date(),
): Promise<string> {
  requireFirmAdmin(actor);
  if (interval !== "month" && interval !== "year") throw new ValidationError({ interval: ["Choose monthly or yearly."] });
  if (!p.isConfigured) throw new IntegrationNotConfiguredError("PayPal", "the operator has not connected PayPal yet.");
  const firm = await getFirm(db, actor.firmId);
  if (firm.status === "active" && firm.paypalSubscriptionId) throw new ValidationError({ _form: ["Your firm already has an active subscription."] });

  let approveUrl: string;
  let subscriptionId: string;
  try {
    const planId = await planFor(db, interval, p);
    const platform = await getPlatformProfile(db);
    const snap = await p.startSubscription({ planId, subscriberName: actor.name, subscriberEmail: actor.email, brandName: platform.name, ...urls });
    if (!snap.approveUrl) throw new ValidationError({ _form: ["PayPal didn’t return a checkout link. Please try again."] });
    approveUrl = snap.approveUrl;
    subscriptionId = snap.id;
  } catch (error) {
    throw paypalFailure("start the subscription", error);
  }
  await db.update(firms).set({ paypalSubscriptionId: subscriptionId, billingInterval: interval, billingSyncedAt: now, updatedAt: now }).where(eq(firms.id, actor.firmId));
  await recordAudit(db, { firmId: actor.firmId, actorUserId: actor.userId, action: "billing.checkout", entityType: "firm", entityId: actor.firmId, metadata: { interval } });
  return approveUrl;
}

/** Refreshes the firm's subscription status from PayPal (throttled unless forced). Never throws. */
export async function syncFirmBilling(db: Db, firmId: string, opts: { force?: boolean } = {}, p: SubscriptionProvider = paypalSubscriptions(), now = new Date()): Promise<Firm> {
  const firm = await getFirm(db, firmId);
  if (!firm.paypalSubscriptionId || !p.isConfigured) return firm;
  if (!opts.force && firm.billingSyncedAt && now.getTime() - firm.billingSyncedAt.getTime() < SYNC_TTL_MS) return firm;
  try {
    const snap = await p.getSubscription(firm.paypalSubscriptionId);
    const status = mapStatus(snap.status);
    const [updated] = await db
      .update(firms)
      .set({ ...(status ? { status } : {}), nextBillingAt: snap.nextBillingAt, billingSyncedAt: now, updatedAt: now })
      .where(eq(firms.id, firmId))
      .returning();
    if (status && status !== firm.status) {
      await recordAudit(db, { firmId, actorUserId: null, action: `billing.${status}`, entityType: "firm", entityId: firmId });
    }
    return updated!;
  } catch (error) {
    console.error("Firm billing refresh failed", { firmId, error: (error as Error)?.name });
    return firm;
  }
}

export interface BillingOverview {
  firm: Firm;
  access: FirmAccess;
  canManage: boolean;
  paypalReady: boolean;
}

export async function getBillingOverview(db: Db, actor: Actor, opts: { force?: boolean } = {}, p: SubscriptionProvider = paypalSubscriptions(), now = new Date()): Promise<BillingOverview> {
  const firm = await syncFirmBilling(db, actor.firmId, opts, p, now);
  return { firm, access: firmAccess(firm, now), canManage: actor.role === "admin", paypalReady: p.isConfigured };
}

/** Stops future charges. Access continues until the paid period ends. */
export async function cancelFirmSubscription(db: Db, actor: Actor, p: SubscriptionProvider = paypalSubscriptions(), now = new Date()): Promise<void> {
  requireFirmAdmin(actor);
  const firm = await getFirm(db, actor.firmId);
  if (!firm.paypalSubscriptionId || firm.status === "cancelled") throw new ValidationError({ _form: ["There is no active subscription to cancel."] });
  try {
    await p.cancelSubscription(firm.paypalSubscriptionId, "Cancelled by the firm");
  } catch (error) {
    throw paypalFailure("cancel the subscription", error);
  }
  await db.update(firms).set({ status: "cancelled", billingSyncedAt: now, updatedAt: now }).where(eq(firms.id, firm.id));
  await recordAudit(db, { firmId: firm.id, actorUserId: actor.userId, action: "billing.cancel", entityType: "firm", entityId: firm.id });
}
