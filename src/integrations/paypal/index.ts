/**
 * PayPal Invoicing (REST v2). Server-only: uses PAYPAL_CLIENT_SECRET.
 *
 * PayPal is the system of record for invoices and payments: it stores the invoice,
 * emails it to the client and hosts the payment page (card or PayPal). The CRM keeps
 * a linked copy (number, amount, status, payment link) and refreshes it from PayPal.
 * Card and bank details never reach this app.
 */

export type PayPalEnvironment = "sandbox" | "live";

export type PayPalInvoiceStatus =
  | "DRAFT"
  | "SENT"
  | "SCHEDULED"
  | "UNPAID"
  | "PAYMENT_PENDING"
  | "PARTIALLY_PAID"
  | "PAID"
  | "MARKED_AS_PAID"
  | "CANCELLED"
  | "REFUNDED"
  | "PARTIALLY_REFUNDED"
  | "MARKED_AS_REFUNDED";

export interface PayPalInvoiceSnapshot {
  id: string;
  invoiceNumber: string;
  status: PayPalInvoiceStatus;
  totalCents: number;
  dueCents: number;
  paidCents: number;
  currency: string;
  /** PayPal-hosted page where the client pays. */
  payUrl: string | null;
}

export interface CreateInvoiceInput {
  recipientName: string;
  recipientEmail: string;
  currency: string;
  dueDate: string | null; // YYYY-MM-DD
  note: string | null;
  items: { name: string; description?: string | null; quantity: number; unitCents: number }[];
}

export class PayPalError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly issue?: string,
  ) {
    super(message);
    this.name = "PayPalError";
  }
}

export function paypalConfig() {
  const clientId = process.env.PAYPAL_CLIENT_ID?.trim() || "";
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET?.trim() || "";
  const environment: PayPalEnvironment = process.env.PAYPAL_ENVIRONMENT?.trim() === "live" ? "live" : "sandbox";
  return {
    clientId,
    clientSecret,
    environment,
    currency: (process.env.PAYPAL_CURRENCY?.trim() || "USD").toUpperCase(),
    baseUrl: environment === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com",
    isConfigured: !!clientId && !!clientSecret,
  };
}

const centsToValue = (cents: number) => (cents / 100).toFixed(2);
const valueToCents = (v: unknown) => (typeof v === "string" || typeof v === "number" ? Math.round(Number(v) * 100) : 0);

let cachedToken: { value: string; expiresAt: number; key: string } | null = null;

async function accessToken(): Promise<string> {
  const cfg = paypalConfig();
  if (!cfg.isConfigured) throw new PayPalError("PayPal is not configured", 0);
  const key = `${cfg.environment}:${cfg.clientId}`;
  if (cachedToken && cachedToken.key === key && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;

  const res = await fetch(`${cfg.baseUrl}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !body.access_token) throw new PayPalError(`PayPal sign-in failed (${body.error ?? res.status})`, res.status, body.error);
  cachedToken = { value: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 300) * 1000, key };
  return body.access_token;
}

async function call<T>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<T> {
  const cfg = paypalConfig();
  const res = await fetch(`${cfg.baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  const text = await res.text();
  const json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!res.ok) {
    const details = (json.details as { issue?: string; description?: string }[] | undefined)?.[0];
    throw new PayPalError(details?.description ?? (json.message as string) ?? `PayPal request failed (${res.status})`, res.status, details?.issue ?? (json.name as string));
  }
  return json as T;
}

interface RawInvoice {
  id: string;
  status: PayPalInvoiceStatus;
  detail?: { invoice_number?: string; currency_code?: string; metadata?: { recipient_view_url?: string } };
  amount?: { value?: string; currency_code?: string };
  due_amount?: { value?: string };
  payments?: { paid_amount?: { value?: string } };
}

function snapshot(raw: RawInvoice): PayPalInvoiceSnapshot {
  const total = valueToCents(raw.amount?.value);
  const paid = valueToCents(raw.payments?.paid_amount?.value);
  return {
    id: raw.id,
    invoiceNumber: raw.detail?.invoice_number ?? "",
    status: raw.status,
    totalCents: total,
    paidCents: paid,
    dueCents: raw.due_amount?.value !== undefined ? valueToCents(raw.due_amount.value) : Math.max(0, total - paid),
    currency: raw.detail?.currency_code ?? raw.amount?.currency_code ?? "USD",
    payUrl: raw.detail?.metadata?.recipient_view_url ?? null,
  };
}

function splitName(full: string): { given_name: string; surname?: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length < 2) return { given_name: full.trim().slice(0, 140) };
  return { given_name: parts.slice(0, -1).join(" ").slice(0, 140), surname: parts.at(-1)!.slice(0, 140) };
}

/** Signs in to PayPal with the app credentials. Throws PayPalError if they are wrong. */
export async function checkConnection(): Promise<void> {
  cachedToken = null;
  await accessToken();
}

/** Creates a DRAFT invoice in PayPal. Nothing is emailed until `sendInvoice`. */
export async function createDraftInvoice(input: CreateInvoiceInput): Promise<PayPalInvoiceSnapshot> {
  const raw = await call<RawInvoice>("POST", "/v2/invoicing/invoices", {
    detail: {
      currency_code: input.currency,
      ...(input.note ? { note: input.note.slice(0, 4000) } : {}),
      ...(input.dueDate ? { payment_term: { due_date: input.dueDate } } : { payment_term: { term_type: "DUE_ON_RECEIPT" } }),
    },
    primary_recipients: [{ billing_info: { name: splitName(input.recipientName), email_address: input.recipientEmail } }],
    items: input.items.map((i) => ({
      name: i.name.slice(0, 200),
      ...(i.description ? { description: i.description.slice(0, 1000) } : {}),
      quantity: String(i.quantity),
      unit_amount: { currency_code: input.currency, value: centsToValue(i.unitCents) },
      unit_of_measure: "QUANTITY",
    })),
  });
  // Some API versions return only a link on create; fetch the full invoice in that case.
  return raw.status ? snapshot(raw) : getInvoice((raw as unknown as { href?: string }).href?.split("/").pop() ?? "");
}

/** Emails the invoice to the client from PayPal and makes it payable. */
export async function sendInvoice(id: string): Promise<PayPalInvoiceSnapshot> {
  await call("POST", `/v2/invoicing/invoices/${encodeURIComponent(id)}/send`, { send_to_recipient: true, send_to_invoicer: false });
  return getInvoice(id);
}

export async function getInvoice(id: string): Promise<PayPalInvoiceSnapshot> {
  if (!id) throw new PayPalError("Missing PayPal invoice id", 0);
  return snapshot(await call<RawInvoice>("GET", `/v2/invoicing/invoices/${encodeURIComponent(id)}`));
}

/** Deletes an invoice that was never sent. PayPal only allows this for drafts. */
export async function deleteDraftInvoice(id: string): Promise<void> {
  await call("DELETE", `/v2/invoicing/invoices/${encodeURIComponent(id)}`);
}

/** Cancels a sent invoice (the client is notified by PayPal). */
export async function cancelInvoice(id: string, note?: string): Promise<void> {
  await call("POST", `/v2/invoicing/invoices/${encodeURIComponent(id)}/cancel`, {
    send_to_recipient: true,
    send_to_invoicer: false,
    ...(note ? { note: note.slice(0, 500) } : {}),
  });
}

/* ───────── Subscriptions (recurring billing) ───────── */

export type PayPalSubscriptionStatus = "APPROVAL_PENDING" | "APPROVED" | "ACTIVE" | "SUSPENDED" | "CANCELLED" | "EXPIRED";

export interface PayPalSubscriptionSnapshot {
  id: string;
  status: PayPalSubscriptionStatus;
  nextBillingAt: Date | null;
  lastPaymentAt: Date | null;
  lastPaymentCents: number | null;
  /** Where the client approves the subscription (only while APPROVAL_PENDING). */
  approveUrl: string | null;
}

/** Creates a product and a fixed-price plan that bills every month or year until cancelled. */
export async function createPlan(input: { name: string; amountCents: number; currency: string; interval: "month" | "year" }): Promise<{ planId: string }> {
  const product = await call<{ id: string }>("POST", "/v1/catalogs/products", {
    name: input.name.slice(0, 127),
    type: "SERVICE",
    category: "ACCOUNTING",
  });
  const plan = await call<{ id: string }>("POST", "/v1/billing/plans", {
    product_id: product.id,
    name: input.name.slice(0, 127),
    status: "ACTIVE",
    billing_cycles: [
      {
        frequency: { interval_unit: input.interval === "year" ? "YEAR" : "MONTH", interval_count: 1 },
        tenure_type: "REGULAR",
        sequence: 1,
        total_cycles: 0, // until cancelled
        pricing_scheme: { fixed_price: { value: centsToValue(input.amountCents), currency_code: input.currency } },
      },
    ],
    payment_preferences: { auto_bill_outstanding: true, payment_failure_threshold: 3 },
  });
  return { planId: plan.id };
}

interface RawSubscription {
  id: string;
  status: PayPalSubscriptionStatus;
  billing_info?: { next_billing_time?: string; last_payment?: { amount?: { value?: string }; time?: string } };
  links?: { href: string; rel: string }[];
}

function subSnapshot(raw: RawSubscription): PayPalSubscriptionSnapshot {
  const last = raw.billing_info?.last_payment;
  return {
    id: raw.id,
    status: raw.status,
    nextBillingAt: raw.billing_info?.next_billing_time ? new Date(raw.billing_info.next_billing_time) : null,
    lastPaymentAt: last?.time ? new Date(last.time) : null,
    lastPaymentCents: last?.amount?.value !== undefined ? valueToCents(last.amount.value) : null,
    approveUrl: raw.links?.find((l) => l.rel === "approve")?.href ?? null,
  };
}

/** Starts checkout for a plan. Send the client to `approveUrl`; PayPal returns them to `returnUrl`. */
export async function startSubscription(input: {
  planId: string;
  subscriberName: string;
  subscriberEmail: string;
  brandName: string;
  returnUrl: string;
  cancelUrl: string;
}): Promise<PayPalSubscriptionSnapshot> {
  const raw = await call<RawSubscription>("POST", "/v1/billing/subscriptions", {
    plan_id: input.planId,
    subscriber: { name: splitName(input.subscriberName), email_address: input.subscriberEmail },
    application_context: {
      brand_name: input.brandName.slice(0, 127),
      user_action: "SUBSCRIBE_NOW",
      shipping_preference: "NO_SHIPPING",
      return_url: input.returnUrl,
      cancel_url: input.cancelUrl,
    },
  });
  return subSnapshot(raw);
}

export async function getSubscription(id: string): Promise<PayPalSubscriptionSnapshot> {
  return subSnapshot(await call<RawSubscription>("GET", `/v1/billing/subscriptions/${encodeURIComponent(id)}`));
}

export async function cancelSubscription(id: string, reason: string): Promise<void> {
  await call("POST", `/v1/billing/subscriptions/${encodeURIComponent(id)}/cancel`, { reason: reason.slice(0, 127) });
}
