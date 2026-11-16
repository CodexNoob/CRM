import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DbHandle } from "@/db";
import { clients, documents, signatureEvents, signatureRequests } from "@/db/schema";
import { verifyEventHash, type SignatureProvider } from "@/integrations/dropbox-sign";
import type { Actor } from "@/lib/auth/actor";
import { AppError, ForbiddenError, NotFoundError } from "@/lib/errors";
import type { FileStorage } from "@/lib/storage";
import { getDocumentForDownload } from "@/services/documents";
import { createEngagement } from "@/services/engagements";
import {
  createSignatureDraft,
  getSignatureRequest,
  listPortalSignatureRequests,
  listSignatureRequests,
  portalSigningUrl,
  processDropboxSignWebhook,
  sendSignatureRequest,
  signatureModuleState,
  voidSignatureRequest,
} from "@/services/esignatures";
import { createClientWithPortalUser, createTestDb, createUser } from "./helpers";

/** E-signatures with a fake Dropbox Sign (no network) and in-memory storage. */

const API_KEY = "test-api-key-0123456789";
const PDF = Buffer.from("%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");

function memoryStorage(): FileStorage & { files: Map<string, Buffer> } {
  const files = new Map<string, Buffer>();
  return {
    provider: "database",
    files,
    async put(k, d) {
      files.set(k, d);
    },
    async get(k) {
      return files.get(k) ?? null;
    },
    async signedUrl() {
      return null;
    },
  };
}

function fakeProvider(opts: { configured?: boolean; enabled?: boolean; embedded?: boolean } = {}) {
  const state = { sent: [] as { title: string; testMode: boolean; signers: string[] }[], cancelled: [] as string[], complete: false, statusFailures: 0, n: 0 };
  const p: SignatureProvider & { state: typeof state } = {
    state,
    name: "dropbox_sign",
    isConfigured: opts.configured ?? true,
    isEnabled: opts.enabled ?? true,
    testMode: true,
    embedded: opts.embedded ?? false,
    async send(input) {
      state.sent.push({ title: input.title, testMode: input.testMode, signers: input.signers.map((s) => s.email) });
      state.n += 1;
      return { providerRequestId: `sr_${state.n}_${randomUUID().slice(0, 6)}`, signatures: input.signers.map((s, i) => ({ signatureId: `sig_${state.n}_${i}`, email: s.email, statusCode: "awaiting_signature" })) };
    },
    async cancel(id) {
      state.cancelled.push(id);
    },
    async downloadSignedPdf() {
      return PDF;
    },
    async embeddedSignUrl(id) {
      return `https://app.hellosign.com/editor/embeddedSign?signature_id=${id}`;
    },
    async getStatus() {
      if (state.statusFailures > 0) {
        state.statusFailures -= 1;
        throw new Error("Temporary provider error");
      }
      return { isComplete: state.complete, isDeclined: false, signatures: [] };
    },
    verifyEvent(ev) {
      return verifyEventHash(API_KEY, ev);
    },
  };
  return p;
}

let seq = 1_900_000_000;
function event(type: string, providerRequestId: string, relatedSignatureId?: string, opts: { tamper?: boolean } = {}) {
  const event_time = String(seq++);
  const event_hash = createHmac("sha256", API_KEY).update(`${event_time}${type}`).digest("hex");
  return JSON.stringify({
    event: { event_time, event_type: type, event_hash: opts.tamper ? event_hash.replace(/^./, (c) => (c === "a" ? "b" : "a")) : event_hash, event_metadata: { related_signature_id: relatedSignatureId } },
    signature_request: { signature_request_id: providerRequestId },
  });
}

let h: DbHandle;
let admin: Actor, manager: Actor, employee: Actor, portalA: Actor, portalB: Actor;
let clientA: string, clientB: string, docA: string, docB: string, engagementA: string;
let storage: ReturnType<typeof memoryStorage>;

async function addDoc(clientId: string, firmId: string) {
  const key = randomUUID();
  storage.files.set(key, PDF);
  const [d] = await h.db
    .insert(documents)
    .values({ firmId, clientId, fileName: "engagement-letter.pdf", contentType: "application/pdf", sizeBytes: PDF.length, sha256: "x", storageKey: key })
    .returning({ id: documents.id });
  return d!.id;
}

beforeAll(async () => {
  h = await createTestDb();
  storage = memoryStorage();
  admin = await createUser(h.db, { role: "admin" });
  manager = await createUser(h.db, { role: "manager" });
  employee = await createUser(h.db, { role: "employee" });
  const a = await createClientWithPortalUser(h.db, admin, "Alpha Client");
  const b = await createClientWithPortalUser(h.db, admin, "Beta Client");
  clientA = a.client.id;
  clientB = b.client.id;
  portalA = a.portalUser;
  portalB = b.portalUser;
  await h.db.update(clients).set({ email: "alpha@example.test" }).where(eq(clients.id, clientA));
  docA = await addDoc(clientA, admin.firmId);
  docB = await addDoc(clientB, admin.firmId);
  engagementA = (await createEngagement(h.db, admin, clientA, { title: "Tax 2026", serviceType: "individual_tax", ownerId: manager.userId })).id;
});
afterAll(async () => {
  await h.close();
});

const draft = (over: Record<string, unknown> = {}) => ({
  title: "2026 engagement letter",
  documentType: "engagement_letter",
  clientId: clientA,
  engagementId: engagementA,
  documentId: docA,
  expiresInDays: "30",
  signers: [
    { name: "Pat Alpha", email: portalA.email, order: 1 },
    { name: "Sam Spouse", email: "spouse@example.test", order: 2 },
  ],
  ...over,
});

describe("availability", () => {
  it("is 'setup required' without credentials: sending is refused and nothing is simulated", async () => {
    const p = fakeProvider({ configured: false, enabled: false });
    expect(signatureModuleState(p)).toBe("setup_required");
    const { id } = await createSignatureDraft(h.db, manager, draft());
    await expect(sendSignatureRequest(h.db, admin, id, { provider: p, storage })).rejects.toBeInstanceOf(AppError);
    expect(p.state.sent).toEqual([]);
    const [row] = await h.db.select().from(signatureRequests).where(eq(signatureRequests.id, id));
    expect(row!.status).toBe("draft");
  });

  it("while testing (configured, not enabled) only admins send, always in test mode", async () => {
    const p = fakeProvider({ enabled: false });
    expect(signatureModuleState(p)).toBe("testing");
    const { id } = await createSignatureDraft(h.db, manager, draft());
    await expect(sendSignatureRequest(h.db, manager, id, { provider: p, storage })).rejects.toBeInstanceOf(ForbiddenError);
    await sendSignatureRequest(h.db, admin, id, { provider: p, storage });
    expect(p.state.sent[0]!.testMode).toBe(true);
  });
});

describe("drafts and sending", () => {
  it("validates the document and engagement belong to the client; employees can't send", async () => {
    await expect(createSignatureDraft(h.db, manager, draft({ documentId: docB }))).rejects.toThrow();
    await expect(createSignatureDraft(h.db, manager, draft({ signers: [{ name: "x", email: "dup@example.test", order: 1 }, { name: "y", email: "dup@example.test", order: 1 }] }))).rejects.toThrow();
    const { id } = await createSignatureDraft(h.db, employee, draft()).catch(async () => createSignatureDraft(h.db, manager, draft()));
    await expect(sendSignatureRequest(h.db, employee, id, { provider: fakeProvider(), storage })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("sends through the provider and stores provider ids; signers are invited", async () => {
    const p = fakeProvider();
    const { id } = await createSignatureDraft(h.db, manager, draft());
    await sendSignatureRequest(h.db, manager, id, { provider: p, storage });
    const d = await getSignatureRequest(h.db, manager, id);
    expect(d.request.status).toBe("sent");
    expect(d.request.providerRequestId).toMatch(/^sr_/);
    expect(d.signers.map((s) => [s.status, !!s.providerSignerId])).toEqual([
      ["sent", true],
      ["sent", true],
    ]);
    expect(d.signers[0]!.portalUserId).toBe(portalA.userId); // matched by email
    await expect(sendSignatureRequest(h.db, manager, id, { provider: p, storage })).rejects.toThrow(); // only drafts
  });

  it("persists provider failures for the dashboard without losing the error detail", async () => {
    const p = fakeProvider();
    p.send = async () => {
      throw new Error("Dropbox Sign rejected the signer address.");
    };
    const { id } = await createSignatureDraft(h.db, manager, draft());
    await expect(sendSignatureRequest(h.db, admin, id, { provider: p, storage })).rejects.toThrow("Dropbox Sign couldn’t send the request");
    const row = (await listSignatureRequests(h.db, admin)).find((r) => r.id === id);
    expect(row).toMatchObject({ status: "failed", failureReason: "Dropbox Sign rejected the signer address." });
  });
});

describe("webhooks", () => {
  let id: string, providerId: string, sig0: string, sig1: string;
  let p: ReturnType<typeof fakeProvider>;
  beforeEach(async () => {
    p = fakeProvider();
    id = (await createSignatureDraft(h.db, manager, draft())).id;
    await sendSignatureRequest(h.db, manager, id, { provider: p, storage });
    const d = await getSignatureRequest(h.db, manager, id);
    providerId = d.request.providerRequestId!;
    sig0 = d.signers[0]!.providerSignerId!;
    sig1 = d.signers[1]!.providerSignerId!;
  });

  it("rejects a tampered hash and changes nothing", async () => {
    const res = await processDropboxSignWebhook(h.db, event("signature_request_all_signed", providerId, undefined, { tamper: true }), { provider: p, storage });
    expect(res).toEqual({ status: 401, outcome: "rejected" });
    expect((await getSignatureRequest(h.db, manager, id)).request.status).toBe("sent");
  });

  it("viewed → partially signed → signed; duplicates are applied once; the signed PDF is stored and linked", async () => {
    expect((await processDropboxSignWebhook(h.db, event("signature_request_viewed", providerId, sig0), { provider: p, storage })).outcome).toBe("processed");
    expect((await getSignatureRequest(h.db, manager, id)).request.status).toBe("viewed");

    const signed = event("signature_request_signed", providerId, sig0);
    expect((await processDropboxSignWebhook(h.db, signed, { provider: p, storage })).outcome).toBe("processed");
    expect((await processDropboxSignWebhook(h.db, signed, { provider: p, storage })).outcome).toBe("duplicate");
    let d = await getSignatureRequest(h.db, manager, id);
    expect(d.request.status).toBe("partially_signed");
    expect(d.signers[0]!.status).toBe("signed");

    // An "all signed" event is NOT trusted until the provider confirms completion.
    p.state.complete = false;
    const allSigned = event("signature_request_all_signed", providerId);
    await expect(processDropboxSignWebhook(h.db, allSigned, { provider: p, storage })).rejects.toThrow("has not confirmed");
    expect((await getSignatureRequest(h.db, manager, id)).request.status).toBe("partially_signed");

    p.state.complete = true;
    await processDropboxSignWebhook(h.db, event("signature_request_signed", providerId, sig1), { provider: p, storage });
    expect(await processDropboxSignWebhook(h.db, allSigned, { provider: p, storage })).toEqual({ status: 200, outcome: "duplicate" });
    d = await getSignatureRequest(h.db, manager, id);
    expect(d.request.status).toBe("signed");
    expect(d.request.completedAt).not.toBeNull();
    expect(d.signedDocument).not.toBeNull();
    const [copy] = await h.db.select().from(documents).where(eq(documents.id, d.request.signedDocumentId!));
    expect(copy).toMatchObject({ clientId: clientA, engagementId: engagementA, visibility: "internal_only", category: "engagement_letters", contentType: "application/pdf" });
    expect(storage.files.get(copy!.storageKey)?.subarray(0, 5).toString()).toBe("%PDF-");
    const retrieved = await getDocumentForDownload(h.db, manager, d.request.signedDocumentId!, { storage });
    expect(retrieved.data).toEqual(PDF);
    const events = await h.db.select().from(signatureEvents).where(eq(signatureEvents.signatureRequestId, id));
    expect(events.length).toBe(4); // viewed, signed, all_signed (retried), signed — each once
  });

  it("retries a recorded completion callback after a temporary provider error", async () => {
    const allSigned = event("signature_request_all_signed", providerId);
    p.state.statusFailures = 1;
    await expect(processDropboxSignWebhook(h.db, allSigned, { provider: p, storage })).rejects.toThrow("Temporary provider error");
    expect((await getSignatureRequest(h.db, manager, id)).request.status).toBe("sent");

    p.state.complete = true;
    expect(await processDropboxSignWebhook(h.db, allSigned, { provider: p, storage })).toEqual({ status: 200, outcome: "duplicate" });
    const completed = await getSignatureRequest(h.db, manager, id);
    expect(completed.request.status).toBe("signed");
    expect(completed.signedDocument).not.toBeNull();
  });

  it("records events for unknown requests without changing anything", async () => {
    const res = await processDropboxSignWebhook(h.db, event("signature_request_all_signed", "sr_unknown"), { provider: p, storage });
    expect(res.outcome).toBe("ignored");
  });

  it("decline and void", async () => {
    await processDropboxSignWebhook(h.db, event("signature_request_declined", providerId, sig1), { provider: p, storage });
    expect((await getSignatureRequest(h.db, manager, id)).request.status).toBe("declined");
    const other = (await createSignatureDraft(h.db, manager, draft())).id;
    await sendSignatureRequest(h.db, manager, other, { provider: p, storage });
    await expect(voidSignatureRequest(h.db, employee, other, { provider: p })).rejects.toBeInstanceOf(ForbiddenError);
    await voidSignatureRequest(h.db, manager, other, { provider: p });
    expect((await getSignatureRequest(h.db, manager, other)).request.status).toBe("voided");
    expect(p.state.cancelled.length).toBe(1);
  });
});

describe("client portal isolation", () => {
  it("shows a client only its own sent requests, and only its own signer can open a session", async () => {
    const p = fakeProvider({ embedded: true });
    const { id } = await createSignatureDraft(h.db, manager, draft());
    await sendSignatureRequest(h.db, manager, id, { provider: p, storage });
    const mine = await listPortalSignatureRequests(h.db, portalA, clientA, { provider: p });
    expect(mine.some((r) => r.id === id)).toBe(true);
    expect(mine.every((r) => r.status !== "draft")).toBe(true);
    const signerA = mine.find((r) => r.id === id)!.signers.find((s) => s.mine)!;
    expect(signerA.canOpen).toBe(true);
    expect(await portalSigningUrl(h.db, portalA, clientA, signerA.id, { provider: p })).toContain("signature_id=");

    // Client B can't list A's requests, can't use A's client id, and can't open A's signer.
    expect((await listPortalSignatureRequests(h.db, portalB, clientB, { provider: p })).some((r) => r.id === id)).toBe(false);
    await expect(listPortalSignatureRequests(h.db, portalB, clientA, { provider: p })).rejects.toBeInstanceOf(NotFoundError);
    await expect(portalSigningUrl(h.db, portalB, clientB, signerA.id, { provider: p })).rejects.toBeInstanceOf(NotFoundError);
    // The other signer on A's request (not this portal user) can't be opened by A either.
    const spouse = mine.find((r) => r.id === id)!.signers.find((s) => !s.mine)!;
    await expect(portalSigningUrl(h.db, portalA, clientA, spouse.id, { provider: p })).rejects.toBeInstanceOf(NotFoundError);
    // Staff lists are scoped too: portal users can't use staff functions.
    await expect(listSignatureRequests(h.db, portalA)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("verifyEventHash is constant-time-safe against wrong lengths and missing fields", () => {
    expect(verifyEventHash(API_KEY, { event_time: "1", event_type: "x", event_hash: "short" })).toBe(false);
    expect(verifyEventHash(API_KEY, { event_type: "x", event_hash: "a".repeat(64) })).toBe(false);
    expect(verifyEventHash("", { event_time: "1", event_type: "x", event_hash: "a".repeat(64) })).toBe(false);
  });
});

