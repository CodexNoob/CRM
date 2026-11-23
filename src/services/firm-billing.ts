import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { firms, paypalWebhookEvents, platformPlans, type Firm } from "@/db/schema";
import * as paypal from "@/integrations/paypal";
import type { PayPalSubscriptionSnapshot, PayPalSubscriptionStatus } from "@/integrations/paypal";
import { product, type PlanInterval } from "@/content/product";
import { isOwner, type Actor } from "@/lib/auth/actor";
import { ForbiddenError, IntegrationNotConfiguredError, ValidationError } from "@/lib/errors";
import { recordAudit } from "./audit";
import { getFirm } from "./firms";

export type AccessState = "trial" | "active" | "past_due" | "locked";
export interface FirmAccess { state: AccessState; locked: boolean; trialDaysLeft: number | null; reason: string | null }

export interface PayPalSubscriptionProvider {
  readonly isConfigured: boolean;
  readonly isWebhookConfigured: boolean;
  readonly currency: string;
  readonly configurationMessage?: string | null;
  createPlan: typeof paypal.createPlan;
  startSubscription: typeof paypal.startSubscription;
  getSubscription: typeof paypal.getSubscription;
  cancelSubscription: typeof paypal.cancelSubscription;
}

export function paypalSubscriptions(): PayPalSubscriptionProvider {
  const config = paypal.paypalConfig();
  return {
    isConfigured: config.isConfigured,
    isWebhookConfigured: config.isWebhookConfigured,
    currency: config.currency,
    configurationMessage: config.configurationMessage,
    createPlan: paypal.createPlan,
    startSubscription: paypal.startSubscription,
    getSubscription: paypal.getSubscription,
    cancelSubscription: paypal.cancelSubscription,
  };
}

const DAY = 24 * 3600_000;
const SYNC_TTL_MS = 2 * 60 * 1000;

function isPlanInterval(value: string | null): value is PlanInterval {
  return value === "month" || value === "year";
}

export function firmAccess(firm: Pick<Firm, "status" | "trialEndsAt" | "nextBillingAt">, now = new Date()): FirmAccess {
  switch (firm.status) {
    case "active":
      return { state: "active", locked: false, trialDaysLeft: null, reason: null };
    case "past_due":
      return { state: "past_due", locked: false, trialDaysLeft: null, reason: "PayPal couldn’t process the last payment. Update your payment method in PayPal to avoid access interruption." };
    case "cancelled":
      if (firm.nextBillingAt && firm.nextBillingAt.getTime() > now.getTime()) return { state: "active", locked: false, trialDaysLeft: null, reason: null };
      return { state: "locked", locked: true, trialDaysLeft: null, reason: "Your subscription has ended. Subscribe again to keep using the CRM; your data is still here." };
    case "trial":
    default: {
      const ends = firm.trialEndsAt?.getTime();
      if (ends === undefined) return { state: "trial", locked: false, trialDaysLeft: null, reason: null };
      if (now.getTime() >= ends) return { state: "locked", locked: true, trialDaysLeft: 0, reason: "Your free trial has ended. Subscribe to keep using the CRM; your data is still here." };
      return { state: "trial", locked: false, trialDaysLeft: Math.max(1, Math.ceil((ends - now.getTime()) / DAY)), reason: null };
    }
  }
}

export function trialEndsAt(now = new Date()): Date {
  return new Date(now.getTime() + product.trialDays * DAY);
}

function requireFirmAdmin(actor: Actor) {
  if (!isOwner(actor)) throw new ForbiddenError("Only the firm Owner can manage the subscription.");
}

function requireCheckoutReady(provider: PayPalSubscriptionProvider) {
  if (!provider.isConfigured) throw new IntegrationNotConfiguredError("PayPal", "Configure PayPal API credentials for this environment.");
  if (!provider.isWebhookConfigured) throw new IntegrationNotConfiguredError("PayPal", "Configure PAYPAL_WEBHOOK_ID before starting subscriptions.");
}

function mapStatus(status: PayPalSubscriptionStatus): Firm["status"] | null {
  switch (status) {
    case "APPROVAL_PENDING":
    case "APPROVED":
      return "trial";
    case "ACTIVE":
      return "active";
    case "SUSPENDED":
      return "past_due";
    case "CANCELLED":
    case "EXPIRED":
      return "cancelled";
    default:
      return null;
  }
}

function paypalFailure(action: string, error: unknown): IntegrationNotConfiguredError {
  const detail = error instanceof paypal.PayPalError ? ` ${error.message}` : "";
  const guidance = error instanceof paypal.PayPalError && error.status === 404 && action === "cancel the pending checkout"
    ? " PayPal did not find the subscription for cancellation. Its pending checkout remains on file; verify it in the same PayPal Sandbox or Live account before retrying. Do not start another checkout until the pending one is resolved."
    : "";
  return new IntegrationNotConfiguredError("PayPal", `Could not ${action}.${detail}${guidance}`);
}

function isPayPalResourceMissing(error: unknown): boolean {
  return error instanceof paypal.PayPalError && error.status === 404 && error.issue === "RESOURCE_NOT_FOUND";
}

async function planFor(db: Db, interval: PlanInterval, provider: PayPalSubscriptionProvider, refresh = false): Promise<string> {
  const plan = product.plans[interval];
  const [existing] = await db.select().from(platformPlans).where(eq(platformPlans.interval, interval)).limit(1);
  if (!refresh && existing && existing.amountCents === plan.amountCents && existing.currency === provider.currency) return existing.paypalPlanId;

  let planId: string;
  try {
    ({ planId } = await provider.createPlan({
      name: `${product.name} - ${plan.label}`,
      amountCents: plan.amountCents,
      currency: provider.currency,
      interval,
    }));
  } catch (error) {
    throw paypalFailure("create the subscription plan", error);
  }
  await db.insert(platformPlans).values({
    interval,
    amountCents: plan.amountCents,
    currency: provider.currency,
    paypalPlanId: planId,
    createdAt: new Date(),
  }).onConflictDoUpdate({
    target: platformPlans.interval,
    set: { amountCents: plan.amountCents, currency: provider.currency, paypalPlanId: planId, createdAt: new Date() },
  });
  return planId;
}

async function syncFromSnapshot(db: Db, firm: Firm, snapshot: PayPalSubscriptionSnapshot, now: Date): Promise<Firm> {
  const mappedStatus = mapStatus(snapshot.status);
  const status = mappedStatus === "active"
    && firm.status === "past_due"
    && firm.paypalLastEventAt
    && (!snapshot.lastPaymentAt || snapshot.lastPaymentAt <= firm.paypalLastEventAt)
    ? null
    : mappedStatus;
  const [updated] = await db.update(firms).set({
    ...(status ? { status } : {}),
    nextBillingAt: snapshot.nextBillingAt ?? firm.nextBillingAt,
    billingSyncedAt: now,
    updatedAt: now,
  }).where(eq(firms.id, firm.id)).returning();
  if (status && status !== firm.status) {
    await recordAudit(db, { firmId: firm.id, actorUserId: null, action: `billing.${status}`, entityType: "firm", entityId: firm.id });
  }
  return updated ?? firm;
}

/** Starts or resumes PayPal approval for the firm subscription. */
export async function startFirmCheckout(
  db: Db,
  actor: Actor,
  interval: unknown,
  urls: { returnUrl: string; cancelUrl: string },
  provider: PayPalSubscriptionProvider = paypalSubscriptions(),
  now = new Date(),
): Promise<string> {
  requireFirmAdmin(actor);
  if (interval !== "month" && interval !== "year") throw new ValidationError({ interval: ["Choose monthly or yearly."] });
  requireCheckoutReady(provider);

  let firm = await getFirm(db, actor.firmId);
  if (firm.paypalSubscriptionId) {
    let existing: PayPalSubscriptionSnapshot;
    try {
      existing = await provider.getSubscription(firm.paypalSubscriptionId);
      firm = await syncFromSnapshot(db, firm, existing, now);
    } catch (error) {
      throw paypalFailure("check the existing subscription", error);
    }
    if (existing.status === "APPROVAL_PENDING") {
      if (existing.approveUrl) return existing.approveUrl;
      throw new IntegrationNotConfiguredError("PayPal", "PayPal has a pending approval without a valid approval link. Contact support before retrying.");
    }
    if (existing.status === "APPROVED" || existing.status === "ACTIVE" || existing.status === "SUSPENDED") {
      throw new ValidationError({ _form: ["Your firm already has a PayPal subscription. Manage its payment method in PayPal."] });
    }
    if (firm.nextBillingAt && firm.nextBillingAt > now) {
      throw new ValidationError({ _form: ["Your cancelled subscription remains active through its paid period. You can subscribe again after it ends."] });
    }
    await db.update(firms).set({
      paypalSubscriptionId: null,
      ...(firm.legacyExternalSubscriptionId ? {} : { legacyExternalSubscriptionId: firm.paypalSubscriptionId }),
      updatedAt: now,
    }).where(eq(firms.id, firm.id));
    firm = { ...firm, paypalSubscriptionId: null };
  }
  if (firm.status === "active" && firm.nextBillingAt && firm.nextBillingAt > now) {
    throw new ValidationError({ _form: ["Your firm already has an active paid period."] });
  }

  const checkout = await db.transaction(async (tx): Promise<{ requestId: string; interval: PlanInterval }> => {
    const [current] = await tx.select().from(firms).where(eq(firms.id, firm.id)).for("update").limit(1);
    if (!current) throw new IntegrationNotConfiguredError("PayPal", "The firm could not be loaded.");
    if (current.paypalSubscriptionId) throw new ValidationError({ _form: ["A PayPal subscription is already being processed. Refresh and try again."] });
    if (current.status === "active" && current.nextBillingAt && current.nextBillingAt > now) {
      throw new ValidationError({ _form: ["Your firm already has an active paid period."] });
    }
    if (current.paypalCheckoutRequestId) {
      const currentInterval = current.billingInterval;
      if (!isPlanInterval(currentInterval)) {
        throw new IntegrationNotConfiguredError("PayPal", "A previous checkout is incomplete. Contact support before trying again.");
      }
      if (currentInterval !== interval) throw new ValidationError({ _form: ["A checkout for another plan is already being processed. Finish or cancel that PayPal checkout first."] });
      return { requestId: current.paypalCheckoutRequestId, interval: currentInterval };
    }
    const requestId = randomUUID();
    await tx.update(firms).set({
      billingInterval: interval,
      paypalCheckoutRequestId: requestId,
      updatedAt: now,
    }).where(eq(firms.id, current.id));
    return { requestId, interval };
  });

  let planId: string;
  let snapshot: PayPalSubscriptionSnapshot;
  try {
    planId = await planFor(db, checkout.interval, provider);
    const start = () => provider.startSubscription({
      planId,
      subscriberName: actor.name,
      subscriberEmail: actor.email,
      brandName: product.name,
      ...urls,
      requestId: checkout.requestId,
    });
    try {
      snapshot = await start();
    } catch (error) {
      // Local databases can retain plan IDs from the other PayPal environment.
      // PayPal's 404 then identifies a stale/foreign plan; create one in the
      // selected environment and retry the same idempotent checkout request.
      if (!(error instanceof paypal.PayPalError && error.status === 404 && error.issue === "RESOURCE_NOT_FOUND")) throw error;
      planId = await planFor(db, checkout.interval, provider, true);
      snapshot = await start();
    }
  } catch (error) {
    await db.update(firms).set({ paypalCheckoutRequestId: null, updatedAt: now })
      .where(and(eq(firms.id, firm.id), eq(firms.paypalCheckoutRequestId, checkout.requestId)));
    throw paypalFailure("start PayPal checkout", error);
  }

  await db.update(firms).set({
    paypalSubscriptionId: snapshot.id,
    paypalCheckoutRequestId: null,
    ...(mapStatus(snapshot.status) ? { status: mapStatus(snapshot.status)! } : {}),
    nextBillingAt: snapshot.nextBillingAt,
    billingSyncedAt: now,
    updatedAt: now,
  }).where(and(eq(firms.id, firm.id), eq(firms.paypalCheckoutRequestId, checkout.requestId)));
  await recordAudit(db, { firmId: firm.id, actorUserId: actor.userId, action: "billing.checkout", entityType: "firm", entityId: firm.id, metadata: { interval: checkout.interval } });
  if (!snapshot.approveUrl) throw new IntegrationNotConfiguredError("PayPal", "PayPal did not return a valid approval link. Retry the checkout; the existing request will be reused.");
  return snapshot.approveUrl;
}

/** Refreshes status from PayPal. Webhooks provide prompt updates; this is a safe fallback. */
export async function syncFirmBilling(
  db: Db,
  firmId: string,
  opts: { force?: boolean } = {},
  provider: PayPalSubscriptionProvider = paypalSubscriptions(),
  now = new Date(),
): Promise<Firm> {
  const firm = await getFirm(db, firmId);
  if (!firm.paypalSubscriptionId || !provider.isConfigured) return firm;
  if (!opts.force && firm.billingSyncedAt && now.getTime() - firm.billingSyncedAt.getTime() < SYNC_TTL_MS) return firm;
  try {
    const snapshot = await provider.getSubscription(firm.paypalSubscriptionId);
    return await syncFromSnapshot(db, firm, snapshot, now);
  } catch (error) {
    console.error("Firm PayPal billing refresh failed", {
      firmId,
      error: error instanceof Error ? error.name : "UnknownError",
      ...(error instanceof paypal.PayPalError ? { status: error.status, issue: error.issue } : {}),
    });
    return firm;
  }
}

export interface BillingOverview {
  firm: Firm;
  access: FirmAccess;
  canManage: boolean;
  paypalReady: boolean;
  paypalSetupMessage: string | null;
}

export async function getBillingOverview(
  db: Db,
  actor: Actor,
  opts: { force?: boolean } = {},
  provider: PayPalSubscriptionProvider = paypalSubscriptions(),
  now = new Date(),
): Promise<BillingOverview> {
  if (!isOwner(actor)) throw new ForbiddenError("Only the firm Owner can access billing.");
  const firm = await syncFirmBilling(db, actor.firmId, opts, provider, now);
  return {
    firm,
    access: firmAccess(firm, now),
    canManage: isOwner(actor),
    paypalReady: provider.isConfigured && provider.isWebhookConfigured,
    paypalSetupMessage: !provider.isConfigured
      ? provider.configurationMessage ?? "Configure the PayPal API credentials for this environment."
      : !provider.isWebhookConfigured
        ? "Set PAYPAL_WEBHOOK_ID to enable secure subscription checkout."
        : null,
  };
}

/** Cancels future PayPal charges while preserving access through the paid period. */
export async function cancelFirmSubscription(
  db: Db,
  actor: Actor,
  provider: PayPalSubscriptionProvider = paypalSubscriptions(),
  now = new Date(),
): Promise<void> {
  requireFirmAdmin(actor);
  const firm = await getFirm(db, actor.firmId);
  if (!firm.paypalSubscriptionId || firm.status === "cancelled") throw new ValidationError({ _form: ["There is no active PayPal subscription to cancel."] });
  if (!provider.isConfigured) throw new IntegrationNotConfiguredError("PayPal", "Configure PayPal API credentials before cancelling this subscription.");
  let snapshot: PayPalSubscriptionSnapshot;
  try {
    snapshot = await provider.getSubscription(firm.paypalSubscriptionId);
  } catch (error) {
    throw paypalFailure("check the subscription before cancelling", error);
  }
  if (snapshot.status === "CANCELLED" || snapshot.status === "EXPIRED") {
    await syncFromSnapshot(db, firm, snapshot, now);
    return;
  }
  if (snapshot.status !== "ACTIVE" && snapshot.status !== "SUSPENDED") {
    await syncFromSnapshot(db, firm, snapshot, now);
    throw new ValidationError({ _form: ["PayPal has not activated this subscription yet."] });
  }
  const paidThrough = snapshot.nextBillingAt ?? firm.nextBillingAt;
  if (!paidThrough) {
    throw new IntegrationNotConfiguredError("PayPal", "PayPal did not provide a confirmed paid-through date. Refresh billing status or contact support before cancelling.");
  }
  try {
    await provider.cancelSubscription(firm.paypalSubscriptionId, "Cancelled by the firm");
  } catch (error) {
    throw paypalFailure("cancel the subscription", error);
  }
  await db.update(firms).set({ status: "cancelled", nextBillingAt: paidThrough, billingSyncedAt: now, updatedAt: now }).where(eq(firms.id, firm.id));
  await recordAudit(db, { firmId: firm.id, actorUserId: actor.userId, action: "billing.cancel", entityType: "firm", entityId: firm.id });
}

/** Cleans up a PayPal subscription the firm declined during approval checkout. */
export async function cancelPendingFirmCheckout(
  db: Db,
  actor: Actor,
  provider: PayPalSubscriptionProvider = paypalSubscriptions(),
  now = new Date(),
): Promise<void> {
  requireFirmAdmin(actor);
  const firm = await getFirm(db, actor.firmId);
  if (!firm.paypalSubscriptionId) return;
  if (!provider.isConfigured) throw new IntegrationNotConfiguredError("PayPal", "Configure PayPal API credentials before cancelling this checkout.");

  let snapshot: PayPalSubscriptionSnapshot;
  try {
    snapshot = await provider.getSubscription(firm.paypalSubscriptionId);
  } catch (error) {
    // If PayPal no longer recognizes this pending ID, it cannot be approved or charged.
    // Clear only this exact stale reference so the admin can start a fresh checkout.
    if (isPayPalResourceMissing(error)) {
      await db.update(firms).set({
        paypalSubscriptionId: null,
        paypalCheckoutRequestId: null,
        billingSyncedAt: now,
        updatedAt: now,
      }).where(and(eq(firms.id, firm.id), eq(firms.paypalSubscriptionId, firm.paypalSubscriptionId)));
      await recordAudit(db, { firmId: firm.id, actorUserId: actor.userId, action: "billing.checkout_stale_cleared", entityType: "firm", entityId: firm.id });
      return;
    }
    throw paypalFailure("check the pending checkout", error);
  }
  if (snapshot.status === "ACTIVE" || snapshot.status === "SUSPENDED") {
    throw new ValidationError({ _form: ["PayPal reports that this subscription is already active. Use subscription settings to cancel future payments."] });
  }
  if (snapshot.status === "APPROVAL_PENDING" || snapshot.status === "APPROVED") {
    try {
      await provider.cancelSubscription(snapshot.id, "Checkout approval was cancelled");
    } catch (error) {
      // Treat PayPal's not-found response as an already-removed pending checkout.
      // The lookup above confirmed this was not an active or suspended subscription.
      if (!isPayPalResourceMissing(error)) throw paypalFailure("cancel the pending checkout", error);
    }
  }
  await db.update(firms).set({
    paypalSubscriptionId: null,
    paypalCheckoutRequestId: null,
    ...(firm.status !== "trial" && firm.status !== "cancelled" && (snapshot.status === "CANCELLED" || snapshot.status === "EXPIRED")
      ? { status: "cancelled" as const }
      : {}),
    billingSyncedAt: now,
    updatedAt: now,
  }).where(and(eq(firms.id, firm.id), eq(firms.paypalSubscriptionId, snapshot.id)));
  await recordAudit(db, { firmId: firm.id, actorUserId: actor.userId, action: "billing.checkout_cancel", entityType: "firm", entityId: firm.id });
}

interface PayPalWebhookEvent {
  id?: unknown;
  event_type?: unknown;
  create_time?: unknown;
  resource?: unknown;
}

const SUBSCRIPTION_EVENTS = new Set([
  "BILLING.SUBSCRIPTION.ACTIVATED",
  "BILLING.SUBSCRIPTION.UPDATED",
  "BILLING.SUBSCRIPTION.CANCELLED",
  "BILLING.SUBSCRIPTION.EXPIRED",
  "BILLING.SUBSCRIPTION.SUSPENDED",
  "BILLING.SUBSCRIPTION.PAYMENT.FAILED",
  "PAYMENT.SALE.COMPLETED",
  "PAYMENT.SALE.DENIED",
]);
const FAILED_PAYMENT_EVENTS = new Set(["BILLING.SUBSCRIPTION.PAYMENT.FAILED", "PAYMENT.SALE.DENIED"]);

function webhookSubscriptionId(eventType: string, resource: Record<string, unknown>): string | null {
  const candidate = eventType.startsWith("BILLING.SUBSCRIPTION.")
    ? resource.id
    : resource.billing_agreement_id ?? resource.subscription_id;
  return typeof candidate === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(candidate) ? candidate : null;
}

/** Records only verified event metadata; payment and subscriber payloads are not retained. */
export async function processPayPalWebhook(
  db: Db,
  event: PayPalWebhookEvent,
  now = new Date(),
  provider: Pick<PayPalSubscriptionProvider, "getSubscription"> = paypalSubscriptions(),
): Promise<"processed" | "duplicate"> {
  if (typeof event.id !== "string" || !/^[A-Za-z0-9._:-]{1,200}$/.test(event.id) || typeof event.event_type !== "string") {
    throw new ValidationError({ _form: ["PayPal webhook event is invalid."] });
  }
  const resource = event.resource && typeof event.resource === "object" ? event.resource as Record<string, unknown> : {};
  const subscriptionId = webhookSubscriptionId(event.event_type, resource);
  const occurredAt = typeof event.create_time === "string" && Number.isFinite(Date.parse(event.create_time))
    ? new Date(event.create_time)
    : null;

  const knownSubscriptionEvent = SUBSCRIPTION_EVENTS.has(event.event_type);
  const snapshot = knownSubscriptionEvent && subscriptionId
    ? await provider.getSubscription(subscriptionId)
    : null;
  if (snapshot && subscriptionId && snapshot.id !== subscriptionId) {
    throw new ValidationError({ _form: ["PayPal returned a mismatched subscription for the webhook event."] });
  }

  return db.transaction(async (tx) => {
    const [inserted] = await tx.insert(paypalWebhookEvents).values({
      eventId: event.id as string,
      eventType: event.event_type as string,
      subscriptionId,
      occurredAt,
      processedAt: now,
    }).onConflictDoNothing().returning({ eventId: paypalWebhookEvents.eventId });
    if (!inserted) return "duplicate";
    if (!snapshot || !subscriptionId) return "processed";

    const [firm] = await tx.select().from(firms)
      .where(eq(firms.paypalSubscriptionId, subscriptionId)).for("update").limit(1);
    if (!firm) return "processed";
    if (occurredAt && firm.paypalLastEventAt && occurredAt <= firm.paypalLastEventAt) return "processed";

    const status = FAILED_PAYMENT_EVENTS.has(event.event_type as string) ? "past_due" : mapStatus(snapshot.status);
    if (!status) return "processed";
    await tx.update(firms).set({
      status,
      nextBillingAt: snapshot.nextBillingAt ?? firm.nextBillingAt,
      billingSyncedAt: now,
      ...(occurredAt ? { paypalLastEventAt: occurredAt } : {}),
      updatedAt: now,
    }).where(eq(firms.id, firm.id));
    if (status !== firm.status) {
      await recordAudit(tx, {
        firmId: firm.id,
        actorUserId: null,
        action: event.event_type === "PAYMENT.SALE.COMPLETED" ? "billing.payment" : `billing.${status}`,
        entityType: "firm",
        entityId: firm.id,
      });
    } else if (event.event_type === "PAYMENT.SALE.COMPLETED") {
      await recordAudit(tx, { firmId: firm.id, actorUserId: null, action: "billing.payment", entityType: "firm", entityId: firm.id });
    }
    return "processed";
  });
}
