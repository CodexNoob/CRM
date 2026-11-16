import "server-only";
import { randomUUID } from "node:crypto";
import { IntegrationNotConfiguredError } from "@/lib/errors";

export type PayPalEnvironment = "sandbox" | "live";
export type PayPalSubscriptionStatus = "APPROVAL_PENDING" | "APPROVED" | "ACTIVE" | "SUSPENDED" | "CANCELLED" | "EXPIRED";

export interface PayPalSubscriptionSnapshot {
  id: string;
  status: PayPalSubscriptionStatus;
  nextBillingAt: Date | null;
  lastPaymentAt: Date | null;
  lastPaymentCents: number | null;
  approveUrl: string | null;
}

export interface PayPalConfig {
  environment: PayPalEnvironment;
  currency: string;
  isConfigured: boolean;
  isWebhookConfigured: boolean;
  configurationMessage: string | null;
}

export class PayPalError extends Error {
  constructor(message: string, readonly status: number, readonly issue?: string) {
    super(message);
    this.name = "PayPalError";
  }
}

const API_URL = {
  sandbox: "https://api-m.sandbox.paypal.com",
  live: "https://api-m.paypal.com",
} as const;
const TIMEOUT_MS = 15_000;

let cachedToken: { value: string; expiresAt: number; key: string } | null = null;

export function paypalConfig(env: Record<string, string | undefined> = process.env): PayPalConfig {
  const requestedEnvironment = env.PAYPAL_ENVIRONMENT?.trim().toLowerCase();
  const environment: PayPalEnvironment = requestedEnvironment === "live" ? "live" : "sandbox";
  const productionMode = env.NODE_ENV === "production";
  const environmentValid = !productionMode || requestedEnvironment === "live";
  const hasCredentials = !!env.PAYPAL_CLIENT_ID?.trim() && !!env.PAYPAL_CLIENT_SECRET?.trim();
  const isConfigured = hasCredentials && environmentValid;
  return {
    environment,
    currency: env.PAYPAL_CURRENCY?.trim().toUpperCase() || "USD",
    isConfigured,
    isWebhookConfigured: !!env.PAYPAL_WEBHOOK_ID?.trim(),
    configurationMessage: !environmentValid
      ? "Production billing requires PAYPAL_ENVIRONMENT=live and PayPal live credentials."
      : !hasCredentials
        ? "Add PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET to the server environment."
        : null,
  };
}

function requireCredentials() {
  const config = paypalConfig();
  const clientId = process.env.PAYPAL_CLIENT_ID?.trim();
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET?.trim();
  if (!config.isConfigured || !clientId || !clientSecret) {
    throw new IntegrationNotConfiguredError("PayPal", config.configurationMessage ?? "PayPal is not configured.");
  }
  return { config, clientId, clientSecret };
}

const centsToValue = (cents: number) => (cents / 100).toFixed(2);
const valueToCents = (value: unknown) => {
  const amount = typeof value === "number" || typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(amount) ? Math.round(amount * 100) : null;
};

async function accessToken(force = false): Promise<string> {
  const { config, clientId, clientSecret } = requireCredentials();
  const key = `${config.environment}:${clientId}`;
  if (!force && cachedToken?.key === key && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;

  const response = await fetch(`${API_URL[config.environment]}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body: unknown = await response.json().catch(() => null);
  const tokenBody = body && typeof body === "object" ? body as { access_token?: unknown; expires_in?: unknown } : {};
  if (!response.ok || typeof tokenBody.access_token !== "string" || typeof tokenBody.expires_in !== "number") {
    throw new PayPalError(`PayPal authentication failed (HTTP ${response.status}).`, response.status);
  }
  cachedToken = {
    value: tokenBody.access_token,
    expiresAt: Date.now() + tokenBody.expires_in * 1000,
    key,
  };
  return tokenBody.access_token;
}

function call<T>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  requestId?: string,
): Promise<T>;
function call(
  method: "GET" | "POST",
  path: string,
  body: unknown,
  requestId: string | undefined,
  expectNoContent: true,
): Promise<void>;
async function call<T>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  requestId?: string,
  expectNoContent = false,
): Promise<T | void> {
  const { config } = requireCredentials();
  const response = await fetch(`${API_URL[config.environment]}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(requestId ? { "PayPal-Request-Id": requestId } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok || (!expectNoContent && (!result || typeof result !== "object"))) {
    const issue = result && typeof result === "object" && typeof (result as { name?: unknown }).name === "string"
      ? (result as { name: string }).name
      : undefined;
    throw new PayPalError(`PayPal request failed (HTTP ${response.status}).`, response.status, issue);
  }
  if (expectNoContent) return;
  return result as T;
}

function splitName(fullName: string) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  return parts.length > 1
    ? { given_name: parts.slice(0, -1).join(" ").slice(0, 140), surname: parts.at(-1)!.slice(0, 140) }
    : { given_name: (parts[0] ?? "Subscriber").slice(0, 140) };
}

export async function checkConnection(): Promise<void> {
  cachedToken = null;
  await accessToken(true);
}

export async function createPlan(input: {
  name: string;
  amountCents: number;
  currency: string;
  interval: "month" | "year";
}): Promise<{ planId: string }> {
  const product = await call<{ id?: string }>("POST", "/v1/catalogs/products", {
    name: input.name.slice(0, 127),
    type: "SERVICE",
    category: "SOFTWARE",
  }, randomUUID());
  if (!product.id) throw new PayPalError("PayPal did not return a product identifier.", 502);
  const plan = await call<{ id?: string }>("POST", "/v1/billing/plans", {
    product_id: product.id,
    name: input.name.slice(0, 127),
    status: "ACTIVE",
    billing_cycles: [{
      frequency: { interval_unit: input.interval === "year" ? "YEAR" : "MONTH", interval_count: 1 },
      tenure_type: "REGULAR",
      sequence: 1,
      total_cycles: 0,
      pricing_scheme: { fixed_price: { value: centsToValue(input.amountCents), currency_code: input.currency } },
    }],
    payment_preferences: { auto_bill_outstanding: true, payment_failure_threshold: 3 },
  }, randomUUID());
  if (!plan.id) throw new PayPalError("PayPal did not return a billing plan identifier.", 502);
  return { planId: plan.id };
}

interface RawSubscription {
  id?: string;
  status?: PayPalSubscriptionStatus;
  billing_info?: {
    next_billing_time?: string;
    last_payment?: { amount?: { value?: string }; time?: string };
  };
  links?: { href: string; rel: string }[];
}

function subscriptionSnapshot(raw: RawSubscription): PayPalSubscriptionSnapshot {
  if (!raw.id || !raw.status) throw new PayPalError("PayPal returned an incomplete subscription.", 502);
  const approveHref = raw.links?.find((link) => link.rel === "approve")?.href;
  let approveUrl: string | null = null;
  if (approveHref) {
    try {
      const url = new URL(approveHref);
      if (url.protocol === "https:" && (url.hostname === "paypal.com" || url.hostname.endsWith(".paypal.com"))) {
        approveUrl = url.toString();
      }
    } catch {
      approveUrl = null;
    }
  }
  const nextBillingAt = raw.billing_info?.next_billing_time ? new Date(raw.billing_info.next_billing_time) : null;
  const lastPaymentAt = raw.billing_info?.last_payment?.time ? new Date(raw.billing_info.last_payment.time) : null;
  return {
    id: raw.id,
    status: raw.status,
    nextBillingAt: nextBillingAt && Number.isFinite(nextBillingAt.getTime()) ? nextBillingAt : null,
    lastPaymentAt: lastPaymentAt && Number.isFinite(lastPaymentAt.getTime()) ? lastPaymentAt : null,
    lastPaymentCents: raw.billing_info?.last_payment?.amount?.value === undefined
      ? null
      : valueToCents(raw.billing_info.last_payment.amount.value),
    approveUrl,
  };
}

export async function startSubscription(input: {
  planId: string;
  subscriberName: string;
  subscriberEmail: string;
  brandName: string;
  returnUrl: string;
  cancelUrl: string;
  requestId: string;
}): Promise<PayPalSubscriptionSnapshot> {
  const raw = await call<RawSubscription>("POST", "/v1/billing/subscriptions", {
    plan_id: input.planId,
    subscriber: {
      name: splitName(input.subscriberName),
      email_address: input.subscriberEmail,
    },
    application_context: {
      brand_name: input.brandName.slice(0, 127),
      user_action: "SUBSCRIBE_NOW",
      shipping_preference: "NO_SHIPPING",
      return_url: input.returnUrl,
      cancel_url: input.cancelUrl,
    },
  }, input.requestId);
  return subscriptionSnapshot(raw);
}

export async function getSubscription(id: string): Promise<PayPalSubscriptionSnapshot> {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new PayPalError("Invalid PayPal subscription identifier.", 400);
  return subscriptionSnapshot(await call<RawSubscription>("GET", `/v1/billing/subscriptions/${encodeURIComponent(id)}`));
}

export async function cancelSubscription(id: string, reason: string): Promise<void> {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new PayPalError("Invalid PayPal subscription identifier.", 400);
  await call("POST", `/v1/billing/subscriptions/${encodeURIComponent(id)}/cancel`, { reason: reason.slice(0, 127) }, undefined, true);
}

export interface PayPalWebhookHeaders {
  authAlgo: string;
  certUrl: string;
  transmissionId: string;
  transmissionSignature: string;
  transmissionTime: string;
}

export async function verifyWebhookSignature(
  headers: PayPalWebhookHeaders,
  event: Record<string, unknown>,
): Promise<boolean> {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID?.trim();
  if (!webhookId) throw new IntegrationNotConfiguredError("PayPal", "Set PAYPAL_WEBHOOK_ID to verify subscription webhooks.");
  if (Object.values(headers).some((value) => !value || value.length > 2048)) return false;
  const result = await call<{ verification_status?: unknown }>(
    "POST",
    "/v1/notifications/verify-webhook-signature",
    {
      auth_algo: headers.authAlgo,
      cert_url: headers.certUrl,
      transmission_id: headers.transmissionId,
      transmission_sig: headers.transmissionSignature,
      transmission_time: headers.transmissionTime,
      webhook_id: webhookId,
      webhook_event: event,
    },
  );
  return result.verification_status === "SUCCESS";
}
