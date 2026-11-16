import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Dropbox Sign (formerly HelloSign) e-signature provider — server-side only.
 * The API key never leaves the server. This module never decides that anything was
 * signed: signing status comes only from provider webhook events whose hash we verify.
 *
 * Config (.env.local):
 *   DROPBOX_SIGN_API_KEY     required to connect
 *   DROPBOX_SIGN_CLIENT_ID   optional; enables embedded (in-portal) signing sessions
 *   DROPBOX_SIGN_TEST_MODE   "1" (default) = test requests with no legal effect
 *   DROPBOX_SIGN_ENABLED     "1" only after the firm has tested end to end
 */

export const DROPBOX_SIGN_PROVIDER = "dropbox_sign";
const BASE = "https://api.hellosign.com/v3";

function apiKey(): string {
  return process.env.DROPBOX_SIGN_API_KEY?.trim() || "";
}

export function dropboxSignConfig() {
  const clientId = process.env.DROPBOX_SIGN_CLIENT_ID?.trim() || "";
  const testMode = (process.env.DROPBOX_SIGN_TEST_MODE?.trim() ?? "1") !== "0";
  const enabledFlag = process.env.DROPBOX_SIGN_ENABLED?.trim() === "1";
  const configured = apiKey().length >= 16;
  return { testMode, isConfigured: configured, isEnabled: configured && enabledFlag, embedded: configured && !!clientId };
}

function redactApiKey(message: string): string {
  const key = apiKey();
  if (!key) return message;
  return message
    .replaceAll(key, "[redacted]")
    .replaceAll(Buffer.from(`${key}:`).toString("base64"), "[redacted]");
}

export class DropboxSignError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(redactApiKey(message));
    this.name = "DropboxSignError";
  }
}

export interface SendInput {
  title: string;
  subject: string;
  message: string;
  signers: { name: string; email: string; order: number }[];
  file: { name: string; data: Buffer; contentType: string };
  testMode: boolean;
  expiresAt?: Date | null;
  /** Echoed back in webhook events (never sensitive). */
  metadata: Record<string, string>;
  /** Embedded signing needs the app client id. */
  clientId?: string;
}

export interface ProviderSignature {
  signatureId: string;
  email: string;
  statusCode: string;
}

export interface SendResult {
  providerRequestId: string;
  signatures: ProviderSignature[];
}

/** The operations the e-signature service needs (swappable in tests). */
export interface SignatureProvider {
  readonly name: string;
  readonly isConfigured: boolean;
  readonly isEnabled: boolean;
  readonly testMode: boolean;
  readonly embedded: boolean;
  send(input: SendInput): Promise<SendResult>;
  cancel(providerRequestId: string): Promise<void>;
  downloadSignedPdf(providerRequestId: string): Promise<Buffer>;
  embeddedSignUrl(signatureId: string): Promise<string>;
  /** Authoritative status straight from the provider (used to confirm completion before trusting it). */
  getStatus(providerRequestId: string): Promise<{ isComplete: boolean; isDeclined: boolean; signatures: ProviderSignature[] }>;
  /** Verifies a webhook event's hash with the API key (constant-time). */
  verifyEvent(event: { event_time?: unknown; event_type?: unknown; event_hash?: unknown }): boolean;
}

export function verifyEventHash(apiKey: string, event: { event_time?: unknown; event_type?: unknown; event_hash?: unknown }): boolean {
  if (!apiKey || typeof event.event_hash !== "string" || event.event_time === undefined || typeof event.event_type !== "string") return false;
  const expected = createHmac("sha256", apiKey).update(`${String(event.event_time)}${event.event_type}`).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(event.event_hash.toLowerCase(), "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

type Fetch = typeof fetch;

async function responseJson<T>(res: Response): Promise<T> {
  try {
    return await res.json() as T;
  } catch {
    throw new DropboxSignError("Dropbox Sign returned an unreadable response", 502);
  }
}

export function dropboxSignProvider(fetchImpl: Fetch = fetch): SignatureProvider {
  const cfg = dropboxSignConfig();
  const key = apiKey();
  const auth = `Basic ${Buffer.from(`${key}:`).toString("base64")}`;

  async function call(path: string, init: RequestInit & { raw?: boolean } = {}) {
    if (!cfg.isConfigured) throw new DropboxSignError("Dropbox Sign is not configured", 0);
    const res = await fetchImpl(`${BASE}${path}`, { ...init, headers: { Authorization: auth, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(30_000), cache: "no-store" });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: { error_msg?: string } };
      throw new DropboxSignError(body.error?.error_msg ?? `Dropbox Sign request failed (${res.status})`, res.status);
    }
    return res;
  }

  return {
    name: DROPBOX_SIGN_PROVIDER,
    isConfigured: cfg.isConfigured,
    isEnabled: cfg.isEnabled,
    testMode: cfg.testMode,
    embedded: cfg.embedded,
    async send(input) {
      const form = new FormData();
      form.set("title", input.title);
      form.set("subject", input.subject);
      form.set("message", input.message);
      form.set("test_mode", input.testMode ? "1" : "0");
      if (input.clientId) form.set("client_id", input.clientId);
      if (input.expiresAt) form.set("expires_at", String(Math.floor(input.expiresAt.getTime() / 1000)));
      input.signers.forEach((s, i) => {
        form.set(`signers[${i}][email_address]`, s.email);
        form.set(`signers[${i}][name]`, s.name);
        form.set(`signers[${i}][order]`, String(s.order));
      });
      for (const [k, v] of Object.entries(input.metadata)) form.set(`metadata[${k}]`, v);
      form.set("file[0]", new Blob([new Uint8Array(input.file.data)], { type: input.file.contentType }), input.file.name);
      // Embedded requests go through the embedded endpoint; others are emailed by Dropbox Sign.
      const path = input.clientId ? "/signature_request/create_embedded" : "/signature_request/send";
      const res = await call(path, { method: "POST", body: form });
      const body = await responseJson<{ signature_request?: { signature_request_id?: string; signatures?: { signature_id: string; signer_email_address: string; status_code: string }[] } }>(res);
      const sr = body.signature_request;
      if (!sr?.signature_request_id) throw new DropboxSignError("Dropbox Sign returned no request id", 502);
      return {
        providerRequestId: sr.signature_request_id,
        signatures: (sr.signatures ?? []).map((s) => ({ signatureId: s.signature_id, email: s.signer_email_address, statusCode: s.status_code })),
      };
    },
    async cancel(id) {
      await call(`/signature_request/cancel/${encodeURIComponent(id)}`, { method: "POST" });
    },
    async downloadSignedPdf(id) {
      const res = await call(`/signature_request/files/${encodeURIComponent(id)}?file_type=pdf`);
      return Buffer.from(await res.arrayBuffer());
    },
    async embeddedSignUrl(signatureId) {
      const res = await call(`/embedded/sign_url/${encodeURIComponent(signatureId)}`, { method: "POST" });
      const body = await responseJson<{ embedded?: { sign_url?: string } }>(res);
      if (!body.embedded?.sign_url) throw new DropboxSignError("Dropbox Sign returned no signing URL", 502);
      return body.embedded.sign_url;
    },
    async getStatus(id) {
      const res = await call(`/signature_request/${encodeURIComponent(id)}`);
      const body = await responseJson<{
        signature_request?: { is_complete?: boolean; is_declined?: boolean; signatures?: { signature_id: string; signer_email_address: string; status_code: string }[] };
      }>(res);
      const sr = body.signature_request ?? {};
      return {
        isComplete: !!sr.is_complete,
        isDeclined: !!sr.is_declined,
        signatures: (sr.signatures ?? []).map((s) => ({ signatureId: s.signature_id, email: s.signer_email_address, statusCode: s.status_code })),
      };
    },
    verifyEvent(event) {
      return verifyEventHash(key, event);
    },
  };
}
