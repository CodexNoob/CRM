import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { IntegrationNotConfiguredError } from "@/lib/errors";

export type QboEnvironment = "sandbox" | "production";
export type QboScope = { type: "firm"; firmId: string };

export interface QboConfig {
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  appUrl?: string;
  tokenEncryptionKey?: string;
  environment: QboEnvironment;
}

export interface QboTokenSet {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
}

export interface QboCustomer {
  id: string;
  displayName: string;
  email: string | null;
}

export interface QboItem {
  id: string;
  name: string;
}

export interface QboInvoiceSnapshot {
  id: string;
  number: string | null;
  totalCents: number;
  balanceCents: number;
  dueDate: string | null;
  status: "open" | "partially_paid" | "paid" | "voided";
  invoiceUrl: string | null;
}

export interface QboInvoiceInput {
  customerId: string;
  itemId: string;
  email: string;
  currency: string;
  dueDate: string | null;
  note: string | null;
  items: { name: string; quantity: number; unitCents: number }[];
}

export class QboError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = "QboError";
  }
}

const CALLBACK_PATH = "/api/integrations/qbo/callback";
const AUTHORIZATION_URL = "https://appcenter.intuit.com/connect/oauth2";
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const REVOKE_URL = "https://developer.api.intuit.com/v2/oauth2/tokens/revoke";
const TIMEOUT_MS = 15_000;

export function readQboConfig(env: Record<string, string | undefined> = process.env): QboConfig {
  const environment = env.QBO_ENVIRONMENT?.trim() === "production" ? "production" : "sandbox";
  return {
    clientId: env.QBO_CLIENT_ID?.trim() || undefined,
    clientSecret: env.QBO_CLIENT_SECRET?.trim() || undefined,
    redirectUri: env.QBO_REDIRECT_URI?.trim() || undefined,
    appUrl: env.APP_URL?.trim() || undefined,
    tokenEncryptionKey: env.QBO_TOKEN_ENCRYPTION_KEY?.trim() || undefined,
    environment,
  };
}

export function exactRedirectUri(config: QboConfig): string {
  if (!config.appUrl || !config.redirectUri) {
    throw new IntegrationNotConfiguredError("QuickBooks Online", "Set APP_URL and QBO_REDIRECT_URI to the exact registered callback URL.");
  }
  let expected: string;
  try {
    const app = new URL(config.appUrl);
    if (app.pathname !== "/" || app.search || app.hash || (app.protocol !== "https:" && !(app.protocol === "http:" && ["localhost", "127.0.0.1"].includes(app.hostname)))) {
      throw new Error();
    }
    expected = `${app.origin}${CALLBACK_PATH}`;
  } catch {
    throw new IntegrationNotConfiguredError("QuickBooks Online", "APP_URL must be the public app origin.");
  }
  if (config.redirectUri !== expected) {
    throw new IntegrationNotConfiguredError("QuickBooks Online", `QBO_REDIRECT_URI must exactly match ${expected}.`);
  }
  return expected;
}

function requireOAuthConfig(config: QboConfig): asserts config is QboConfig & { clientId: string; clientSecret: string; redirectUri: string } {
  if (!config.clientId || !config.clientSecret) {
    throw new IntegrationNotConfiguredError("QuickBooks Online", "Add QBO_CLIENT_ID and QBO_CLIENT_SECRET in server settings.");
  }
  exactRedirectUri(config);
}

function tokenKey(config: QboConfig): Buffer {
  const encoded = config.tokenEncryptionKey;
  if (!encoded) throw new IntegrationNotConfiguredError("QuickBooks Online", "Set QBO_TOKEN_ENCRYPTION_KEY before connecting a company.");
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) throw new IntegrationNotConfiguredError("QuickBooks Online", "QBO_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  return key;
}

export function encryptToken(value: string, config: QboConfig = readQboConfig()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", tokenKey(config), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptToken(value: string, config: QboConfig = readQboConfig()): string {
  const [version, ivText, tagText, encryptedText, ...extra] = value.split(".");
  if (version !== "v1" || !ivText || !tagText || !encryptedText || extra.length) {
    throw new IntegrationNotConfiguredError("QuickBooks Online", "The saved connection cannot be decrypted; disconnect and reconnect QuickBooks.");
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", tokenKey(config), Buffer.from(ivText, "base64url"));
    decipher.setAuthTag(Buffer.from(tagText, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(encryptedText, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw new IntegrationNotConfiguredError("QuickBooks Online", "The saved connection cannot be decrypted; check QBO_TOKEN_ENCRYPTION_KEY or reconnect QuickBooks.");
  }
}

export function authorizationUrl(state: string, config: QboConfig = readQboConfig()): string {
  requireOAuthConfig(config);
  const url = new URL(AUTHORIZATION_URL);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "com.intuit.quickbooks.accounting");
  url.searchParams.set("redirect_uri", exactRedirectUri(config));
  url.searchParams.set("state", state);
  return url.toString();
}

async function tokenRequest(body: URLSearchParams, config: QboConfig): Promise<QboTokenSet> {
  requireOAuthConfig(config);
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const json: unknown = await response.json().catch(() => null);
  if (!response.ok || !json || typeof json !== "object") {
    throw new QboError("QuickBooks authorization failed. Check the Intuit app configuration and reconnect.", response.status);
  }
  const tokens = json as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown; x_refresh_token_expires_in?: unknown };
  if (typeof tokens.access_token !== "string" || typeof tokens.refresh_token !== "string" || typeof tokens.expires_in !== "number" || typeof tokens.x_refresh_token_expires_in !== "number") {
    throw new QboError("QuickBooks returned an incomplete authorization response.", response.status);
  }
  const now = Date.now();
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    accessExpiresAt: new Date(now + tokens.expires_in * 1000),
    refreshExpiresAt: new Date(now + tokens.x_refresh_token_expires_in * 1000),
  };
}

export function exchangeAuthorizationCode(code: string, config: QboConfig = readQboConfig()): Promise<QboTokenSet> {
  if (!code || code.length > 4096) throw new QboError("QuickBooks returned an invalid authorization code.", 400);
  requireOAuthConfig(config);
  return tokenRequest(new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: exactRedirectUri(config),
  }), config);
}

export function refreshTokens(refreshToken: string, config: QboConfig = readQboConfig()): Promise<QboTokenSet> {
  if (!refreshToken) throw new QboError("QuickBooks connection must be reauthorized.", 401);
  return tokenRequest(new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }), config);
}

export async function revokeToken(refreshToken: string, config: QboConfig = readQboConfig()): Promise<void> {
  requireOAuthConfig(config);
  const response = await fetch(REVOKE_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ token: refreshToken }),
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new QboError("QuickBooks could not revoke the disconnected company authorization.", response.status);
}

const apiBase = (environment: QboEnvironment) =>
  environment === "sandbox" ? "https://sandbox-quickbooks.api.intuit.com/v3/company" : "https://quickbooks.api.intuit.com/v3/company";

export async function qboRequest<T>(
  accessToken: string,
  realmId: string,
  path: string,
  options: { method?: "GET" | "POST"; body?: unknown; requestId?: string; config?: QboConfig } = {},
): Promise<T> {
  if (!/^[\w.-]+$/.test(realmId) || !path.startsWith("/") || path.startsWith("//")) throw new QboError("Invalid QuickBooks company request.", 400);
  const config = options.config ?? readQboConfig();
  const url = new URL(`${apiBase(config.environment)}/${encodeURIComponent(realmId)}${path}`);
  if (options.requestId) url.searchParams.set("requestid", options.requestId);
  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const json: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const code = json && typeof json === "object"
      ? String(((json as { Fault?: { Error?: { code?: string }[] } }).Fault?.Error?.[0]?.code) ?? "")
      : "";
    throw new QboError(`QuickBooks request failed (HTTP ${response.status}${code ? `, code ${code}` : ""}).`, response.status, code || undefined);
  }
  if (json === null) throw new QboError("QuickBooks returned an invalid response.", response.status);
  return json as T;
}

export async function getCompanyInfo(accessToken: string, realmId: string, config: QboConfig = readQboConfig()): Promise<string> {
  const response = await qboRequest<{ CompanyInfo?: { CompanyName?: string } }>(accessToken, realmId, `/companyinfo/${encodeURIComponent(realmId)}`, { config });
  const name = response.CompanyInfo?.CompanyName;
  if (!name || typeof name !== "string") throw new QboError("QuickBooks did not return company information.", 502);
  return name;
}

function cents(value: unknown): number {
  const amount = typeof value === "number" || typeof value === "string" ? Number(value) : 0;
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}

interface RawQboInvoice {
  Id?: string;
  DocNumber?: string;
  TotalAmt?: number;
  Balance?: number;
  DueDate?: string;
  TxnStatus?: string;
  InvoiceLink?: string;
}

export function invoiceSnapshot(raw: RawQboInvoice): QboInvoiceSnapshot {
  if (!raw.Id) throw new QboError("QuickBooks returned an invoice without an identifier.", 502);
  const totalCents = cents(raw.TotalAmt);
  const balanceCents = cents(raw.Balance);
  const status = raw.TxnStatus === "Voided" ? "voided" : balanceCents <= 0 ? "paid" : balanceCents < totalCents ? "partially_paid" : "open";
  return {
    id: raw.Id,
    number: raw.DocNumber ?? null,
    totalCents,
    balanceCents,
    dueDate: raw.DueDate ?? null,
    status,
    invoiceUrl: typeof raw.InvoiceLink === "string" && raw.InvoiceLink.startsWith("https://") ? raw.InvoiceLink : null,
  };
}

function queryPath(query: string) {
  return `/query?query=${encodeURIComponent(query)}`;
}

export async function listCustomers(accessToken: string, realmId: string, config: QboConfig = readQboConfig()): Promise<QboCustomer[]> {
  const response = await qboRequest<{ QueryResponse?: { Customer?: { Id?: string; DisplayName?: string; PrimaryEmailAddr?: { Address?: string } }[] } }>(
    accessToken,
    realmId,
    queryPath("select * from Customer where Active = true maxresults 1000"),
    { config },
  );
  return (response.QueryResponse?.Customer ?? []).flatMap((customer) =>
    customer.Id && customer.DisplayName
      ? [{ id: customer.Id, displayName: customer.DisplayName, email: customer.PrimaryEmailAddr?.Address ?? null }]
      : [],
  );
}

export async function listServiceItems(accessToken: string, realmId: string, config: QboConfig = readQboConfig()): Promise<QboItem[]> {
  const response = await qboRequest<{ QueryResponse?: { Item?: { Id?: string; Name?: string; Type?: string }[] } }>(
    accessToken,
    realmId,
    queryPath("select * from Item where Active = true and Type = 'Service' maxresults 1000"),
    { config },
  );
  return (response.QueryResponse?.Item ?? []).flatMap((item) =>
    item.Id && item.Name && item.Type === "Service" ? [{ id: item.Id, name: item.Name }] : [],
  );
}

export async function createInvoice(
  accessToken: string,
  realmId: string,
  input: QboInvoiceInput,
  requestId: string,
  config: QboConfig = readQboConfig(),
): Promise<QboInvoiceSnapshot> {
  const response = await qboRequest<{ Invoice?: RawQboInvoice }>(accessToken, realmId, "/invoice", {
    method: "POST",
    requestId,
    config,
    body: {
      CustomerRef: { value: input.customerId },
      BillEmail: { Address: input.email },
      ...(input.dueDate ? { DueDate: input.dueDate } : {}),
      ...(input.note ? { PrivateNote: input.note.slice(0, 4000) } : {}),
      CurrencyRef: { value: input.currency },
      Line: input.items.map((item) => ({
        Amount: (item.quantity * item.unitCents) / 100,
        Description: item.name.slice(0, 200),
        DetailType: "SalesItemLineDetail",
        SalesItemLineDetail: {
          ItemRef: { value: input.itemId },
          Qty: item.quantity,
          UnitPrice: item.unitCents / 100,
        },
      })),
    },
  });
  if (!response.Invoice) throw new QboError("QuickBooks did not return the created invoice.", 502);
  return invoiceSnapshot(response.Invoice);
}

export async function sendInvoice(accessToken: string, realmId: string, id: string, email: string, config: QboConfig = readQboConfig()): Promise<QboInvoiceSnapshot> {
  await qboRequest(accessToken, realmId, `/invoice/${encodeURIComponent(id)}/send?sendTo=${encodeURIComponent(email)}`, { method: "POST", config });
  return getInvoice(accessToken, realmId, id, config);
}

export async function getInvoice(accessToken: string, realmId: string, id: string, config: QboConfig = readQboConfig()): Promise<QboInvoiceSnapshot> {
  const response = await qboRequest<{ Invoice?: RawQboInvoice }>(accessToken, realmId, `/invoice/${encodeURIComponent(id)}`, { config });
  if (!response.Invoice) throw new QboError("QuickBooks did not return the invoice.", 502);
  return invoiceSnapshot(response.Invoice);
}

export async function voidInvoice(accessToken: string, realmId: string, id: string, config: QboConfig = readQboConfig()): Promise<void> {
  const response = await qboRequest<{ Invoice?: { Id?: string; SyncToken?: string } }>(
    accessToken,
    realmId,
    `/invoice/${encodeURIComponent(id)}`,
    { config },
  );
  const invoice = response.Invoice;
  if (!invoice?.Id || !invoice.SyncToken) throw new QboError("QuickBooks did not return invoice version information.", 502);
  await qboRequest(accessToken, realmId, "/invoice?operation=void", {
    method: "POST",
    body: { Id: invoice.Id, SyncToken: invoice.SyncToken },
    config,
  });
}
