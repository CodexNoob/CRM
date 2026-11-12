import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db";
import {
  clients,
  documents,
  engagements,
  portalClientAccess,
  signatureEvents,
  signatureRequests,
  signatureSigners,
  taxReturns,
  users,
  type SignatureStatus,
} from "@/db/schema";
import { dropboxSignProvider, type SignatureProvider } from "@/integrations/dropbox-sign";
import type { Actor } from "@/lib/auth/actor";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { defaultStorage, type FileStorage } from "@/lib/storage";
import { isUuid, parseInput } from "@/lib/validation";
import { assertClientAccess, inFirm, requirePermission, visibleClientsCondition } from "./access";
import { recordAudit } from "./audit";
import { notifyClientUsers } from "./client-notifications";
import { getDocumentForDownload } from "./documents";
import { assertPortalClientAccess } from "./portal-access";
import { logActivity, nextNumber, type CounterKind } from "./timeline";

/**
 * E-signatures through a real provider (Dropbox Sign). Rules:
 *  - Nothing is ever marked signed except from a VERIFIED provider webhook event, and
 *    completion is re-confirmed with the provider's API before the signed copy is stored.
 *  - Without credentials the module is "setup required": drafts can't be sent, nothing is simulated.
 *  - Until the firm sets DROPBOX_SIGN_ENABLED=1 (after testing), only admins may send, in test mode.
 *  - Each webhook event is processed once (unique event hash); duplicates are acknowledged and ignored.
 */

export interface SignatureDeps {
  provider?: SignatureProvider;
  storage?: FileStorage;
}

const prov = (d: SignatureDeps) => d.provider ?? dropboxSignProvider();

export type ModuleState = "setup_required" | "testing" | "enabled";

export function signatureModuleState(provider: Pick<SignatureProvider, "isConfigured" | "isEnabled"> = dropboxSignProvider()): ModuleState {
  if (!provider.isConfigured) return "setup_required";
  return provider.isEnabled ? "enabled" : "testing";
}

/* ───────── Validation (kept local to this module) ───────── */

const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const optUuid = z.preprocess(blank, z.uuid().optional());

export const signatureDraftSchema = z.object({
  title: z.string({ error: "Title is required." }).trim().min(1, "Title is required.").max(200),
  message: z.preprocess(blank, z.string().trim().max(2000).optional()),
  documentType: z
    .enum(["engagement_letter", "service_agreement", "tax_filing_authorization", "client_consent", "disclosure", "financial_information_authorization", "other"], { error: "Choose a document type." })
    .default("other"),
  clientId: z.uuid("Choose a client."),
  engagementId: optUuid,
  taxReturnId: optUuid,
  documentId: z.uuid("Choose the document to be signed."),
  expiresInDays: z.preprocess(blank, z.coerce.number().int().min(1, "At least 1 day.").max(90, "At most 90 days.").optional()),
  signers: z
    .array(
      z.object({
        name: z.string().trim().min(1, "Signer name is required.").max(200),
        email: z.email("Enter a valid signer email.").max(254).transform((s) => s.toLowerCase()),
        role: z.preprocess(blank, z.string().trim().max(100).optional()),
        order: z.coerce.number().int().min(1).max(10),
      }),
    )
    .min(1, "Add at least one signer.")
    .max(10, "At most 10 signers."),
});

/* ───────── Reads ───────── */

export interface SignatureRequestRow {
  id: string;
  requestNumber: number | null;
  title: string;
  documentType: string;
  status: SignatureStatus;
  testMode: boolean;
  clientId: string;
  clientName: string;
  engagementId: string | null;
  sentAt: Date | null;
  expiresAt: Date | null;
  completedAt: Date | null;
  signerCount: number;
  signedCount: number;
}

export async function listSignatureRequests(db: Db, actor: Actor, f: { status?: SignatureStatus; clientId?: string } = {}): Promise<SignatureRequestRow[]> {
  requirePermission(actor, "esignatures", "view");
  const visible = visibleClientsCondition(db, actor);
  return db
    .select({
      id: signatureRequests.id,
      requestNumber: signatureRequests.requestNumber,
      title: signatureRequests.title,
      documentType: signatureRequests.documentType,
      status: signatureRequests.status,
      testMode: signatureRequests.testMode,
      clientId: signatureRequests.clientId,
      clientName: clients.displayName,
      engagementId: signatureRequests.engagementId,
      sentAt: signatureRequests.sentAt,
      expiresAt: signatureRequests.expiresAt,
      completedAt: signatureRequests.completedAt,
      signerCount: sql<number>`(select count(*)::int from ${signatureSigners} s where s.signature_request_id = ${signatureRequests.id} and s.firm_id = ${signatureRequests.firmId})`,
      signedCount: sql<number>`(select count(*)::int from ${signatureSigners} s where s.signature_request_id = ${signatureRequests.id} and s.firm_id = ${signatureRequests.firmId} and s.status = 'signed')`,
    })
    .from(signatureRequests)
    .innerJoin(clients, and(eq(clients.id, signatureRequests.clientId), eq(clients.firmId, signatureRequests.firmId)))
    .where(and(inFirm(signatureRequests.firmId, actor), visible, f.status ? eq(signatureRequests.status, f.status) : undefined, f.clientId && isUuid(f.clientId) ? eq(signatureRequests.clientId, f.clientId) : undefined))
    .orderBy(desc(signatureRequests.createdAt))
    .limit(500);
}

async function loadRequest(db: Db, actor: Actor, id: string) {
  if (!isUuid(id)) throw new NotFoundError();
  const [row] = await db.select().from(signatureRequests).where(and(eq(signatureRequests.id, id), inFirm(signatureRequests.firmId, actor)));
  if (!row) throw new NotFoundError();
  await assertClientAccess(db, actor, row.clientId);
  return row;
}

export async function getSignatureRequest(db: Db, actor: Actor, id: string) {
  requirePermission(actor, "esignatures", "view");
  const request = await loadRequest(db, actor, id);
  const [[client], signers, events, [doc], [signedDoc], [engagement]] = await Promise.all([
    db.select({ name: clients.displayName }).from(clients).where(and(eq(clients.id, request.clientId), inFirm(clients.firmId, actor))),
    db.select().from(signatureSigners).where(and(eq(signatureSigners.signatureRequestId, id), inFirm(signatureSigners.firmId, actor))).orderBy(asc(signatureSigners.signingOrder), asc(signatureSigners.createdAt)),
    db
      .select({ id: signatureEvents.id, eventType: signatureEvents.eventType, occurredAt: signatureEvents.occurredAt, receivedAt: signatureEvents.receivedAt })
      .from(signatureEvents)
      .where(and(eq(signatureEvents.signatureRequestId, id), inFirm(signatureEvents.firmId as never, actor)))
      .orderBy(asc(signatureEvents.receivedAt)),
    request.documentId ? db.select({ id: documents.id, fileName: documents.fileName }).from(documents).where(and(eq(documents.id, request.documentId), inFirm(documents.firmId, actor))) : Promise.resolve([]),
    request.signedDocumentId ? db.select({ id: documents.id, fileName: documents.fileName }).from(documents).where(and(eq(documents.id, request.signedDocumentId), inFirm(documents.firmId, actor))) : Promise.resolve([]),
    request.engagementId ? db.select({ id: engagements.id, title: engagements.title }).from(engagements).where(and(eq(engagements.id, request.engagementId), inFirm(engagements.firmId, actor))) : Promise.resolve([]),
  ]);
  return { request, clientName: client?.name ?? "", signers, events, document: doc ?? null, signedDocument: signedDoc ?? null, engagement: engagement ?? null };
}

/** Options for the "new request" form: visible clients' signable documents and engagements. */
export async function listSignatureFormOptions(db: Db, actor: Actor) {
  requirePermission(actor, "esignatures", "create");
  const visible = visibleClientsCondition(db, actor);
  const [clientRows, docRows, engagementRows] = await Promise.all([
    db.select({ id: clients.id, name: clients.displayName }).from(clients).where(and(inFirm(clients.firmId, actor), visible, sql`${clients.archivedAt} is null`)).orderBy(asc(clients.displayName)).limit(5000),
    db
      .select({ id: documents.id, clientId: documents.clientId, name: sql<string>`coalesce(${documents.title}, ${documents.fileName})` })
      .from(documents)
      .innerJoin(clients, eq(clients.id, documents.clientId))
      .where(and(inFirm(documents.firmId, actor), visible, sql`${documents.deletedAt} is null`, inArray(documents.contentType, ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"])))
      .orderBy(desc(documents.createdAt))
      .limit(5000),
    db
      .select({ id: engagements.id, clientId: engagements.clientId, title: engagements.title })
      .from(engagements)
      .innerJoin(clients, eq(clients.id, engagements.clientId))
      .where(and(inFirm(engagements.firmId, actor), visible, sql`${engagements.status} not in ('closed','cancelled')`))
      .orderBy(asc(engagements.title))
      .limit(5000),
  ]);
  return { clients: clientRows, documents: docRows, engagements: engagementRows };
}

/* ───────── Draft / send / void ───────── */

export async function createSignatureDraft(db: Db, actor: Actor, input: unknown): Promise<{ id: string }> {
  requirePermission(actor, "esignatures", "create");
  const d = parseInput(signatureDraftSchema, input);
  await assertClientAccess(db, actor, d.clientId);
  if (d.engagementId) {
    const [e] = await db.select({ clientId: engagements.clientId }).from(engagements).where(and(eq(engagements.id, d.engagementId), inFirm(engagements.firmId, actor)));
    if (!e || e.clientId !== d.clientId) throw new ValidationError({ engagementId: ["That engagement belongs to a different client."] });
  }
  if (d.taxReturnId) {
    const [r] = await db.select({ clientId: taxReturns.clientId }).from(taxReturns).where(and(eq(taxReturns.id, d.taxReturnId), inFirm(taxReturns.firmId, actor)));
    if (!r || r.clientId !== d.clientId) throw new ValidationError({ taxReturnId: ["That tax return belongs to a different client."] });
  }
  const [doc] = await db
    .select({ clientId: documents.clientId, contentType: documents.contentType, deletedAt: documents.deletedAt })
    .from(documents)
    .where(and(eq(documents.id, d.documentId), inFirm(documents.firmId, actor)));
  if (!doc || doc.deletedAt || doc.clientId !== d.clientId) throw new ValidationError({ documentId: ["Choose a document of this client."] });
  if (!["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"].includes(doc.contentType)) {
    throw new ValidationError({ documentId: ["Only PDF and Word documents can be sent for signature."] });
  }
  const emails = d.signers.map((s) => s.email);
  if (new Set(emails).size !== emails.length) throw new ValidationError({ signers: ["Each signer needs a different email address."] });

  // Signers who are portal users of this client can open their session from the portal.
  const portalUsers = await db
    .select({ id: users.id, email: users.email })
    .from(portalClientAccess)
    .innerJoin(users, eq(users.id, portalClientAccess.userId))
    .where(and(inFirm(portalClientAccess.firmId, actor), eq(portalClientAccess.clientId, d.clientId), eq(portalClientAccess.status, "active")));
  const byEmail = new Map(portalUsers.map((u) => [u.email.toLowerCase(), u.id]));

  return db.transaction(async (txRaw) => {
    const t = txRaw as unknown as Db;
    const [row] = await t
      .insert(signatureRequests)
      .values({
        firmId: actor.firmId,
        clientId: d.clientId,
        requestNumber: await nextNumber(t, actor.firmId, "signature_request" as CounterKind),
        engagementId: d.engagementId ?? null,
        taxReturnId: d.taxReturnId ?? null,
        documentId: d.documentId,
        documentType: d.documentType,
        provider: "dropbox_sign",
        title: d.title,
        message: d.message ?? null,
        status: "draft",
        expiresAt: d.expiresInDays ? new Date(Date.now() + d.expiresInDays * 86_400_000) : null,
      })
      .returning({ id: signatureRequests.id });
    await t.insert(signatureSigners).values(
      d.signers.map((s) => ({ firmId: actor.firmId, signatureRequestId: row!.id, name: s.name, email: s.email, role: s.role ?? null, signingOrder: s.order, portalUserId: byEmail.get(s.email) ?? null })),
    );
    await recordAudit(t, { firmId: actor.firmId, actorUserId: actor.userId, action: "signature.create", entityType: "signature_request", entityId: row!.id, metadata: { clientId: d.clientId } });
    return { id: row!.id };
  });
}

/** Sends a draft through the provider. Refused (nothing simulated) if the provider isn't configured. */
export async function sendSignatureRequest(db: Db, actor: Actor, id: string, deps: SignatureDeps = {}): Promise<void> {
  requirePermission(actor, "esignatures", "send");
  const provider = prov(deps);
  if (!provider.isConfigured) throw new AppError("E-signatures aren’t set up yet. Connect Dropbox Sign first — nothing was sent.");
  if (!provider.isEnabled && actor.role !== "admin") throw new ForbiddenError("E-signatures are still being tested. Only an admin can send test requests.");
  const testMode = provider.isEnabled ? provider.testMode : true;

  const req = await loadRequest(db, actor, id);
  if (req.status !== "draft") throw new ValidationError({ _form: ["Only a draft can be sent."] });
  if (!req.documentId) throw new ValidationError({ documentId: ["Choose the document to be signed."] });
  const signers = await db.select().from(signatureSigners).where(and(eq(signatureSigners.signatureRequestId, id), inFirm(signatureSigners.firmId, actor))).orderBy(asc(signatureSigners.signingOrder));
  if (!signers.length) throw new ValidationError({ signers: ["Add at least one signer."] });
  const { doc, data } = await getDocumentForDownload(db, actor, req.documentId, { storage: deps.storage });

  let result;
  try {
    result = await provider.send({
      title: req.title,
      subject: req.title,
      message: req.message ?? "Please review and sign this document.",
      signers: signers.map((s) => ({ name: s.name, email: s.email, order: s.signingOrder })),
      file: { name: doc.fileName, data, contentType: doc.contentType },
      testMode,
      expiresAt: req.expiresAt,
      metadata: { crm_request: req.id },
      clientId: provider.embedded ? dropboxClientId() : undefined,
    });
  } catch (error) {
    const reason = (error as Error)?.message?.slice(0, 300) ?? "Provider error";
    await db.update(signatureRequests).set({ status: "failed", failureReason: reason, updatedAt: new Date() }).where(and(eq(signatureRequests.id, id), inFirm(signatureRequests.firmId, actor)));
    throw new AppError(`Dropbox Sign couldn’t send the request: ${reason}`);
  }

  const now = new Date();
  await db.transaction(async (txRaw) => {
    const t = txRaw as unknown as Db;
    await t
      .update(signatureRequests)
      .set({ status: "sent", providerRequestId: result.providerRequestId, testMode, sentById: actor.userId, sentAt: now, failureReason: null, updatedAt: now })
      .where(and(eq(signatureRequests.id, id), inFirm(signatureRequests.firmId, actor)));
    for (const s of signers) {
      const match = result.signatures.find((p) => p.email.toLowerCase() === s.email.toLowerCase());
      await t.update(signatureSigners).set({ status: "sent", providerSignerId: match?.signatureId ?? null, updatedAt: now }).where(eq(signatureSigners.id, s.id));
    }
    await recordAudit(t, { firmId: actor.firmId, actorUserId: actor.userId, action: "signature.send", entityType: "signature_request", entityId: id, metadata: { clientId: req.clientId, testMode } });
    await logActivity(t, actor, {
      entityType: req.engagementId ? "engagement" : "client",
      entityId: req.engagementId ?? req.clientId,
      clientId: req.clientId,
      type: "system",
      body: `Signature request sent${testMode ? " (test mode)" : ""}: ${req.title}`,
    });
  });
  await notifyClientUsers(db, actor.firmId, req.clientId, { type: "signature_request", title: `Signature requested: ${req.title}`, href: "/portal/signatures", dedupeKey: `sig:${id}` });
}

function dropboxClientId() {
  return process.env.DROPBOX_SIGN_CLIENT_ID?.trim() || undefined;
}

export async function voidSignatureRequest(db: Db, actor: Actor, id: string, deps: SignatureDeps = {}): Promise<void> {
  requirePermission(actor, "esignatures", "void");
  const req = await loadRequest(db, actor, id);
  if (req.status === "draft") {
    await db.update(signatureRequests).set({ status: "voided", updatedAt: new Date() }).where(and(eq(signatureRequests.id, id), inFirm(signatureRequests.firmId, actor)));
  } else {
    if (!["sent", "viewed", "partially_signed"].includes(req.status)) throw new ValidationError({ _form: ["This request can no longer be voided."] });
    if (!req.providerRequestId) throw new ValidationError({ _form: ["This request has no provider reference."] });
    try {
      await prov(deps).cancel(req.providerRequestId);
    } catch (error) {
      throw new AppError(`Dropbox Sign couldn’t cancel the request: ${(error as Error)?.message?.slice(0, 200) ?? "provider error"}`);
    }
    await db.update(signatureRequests).set({ status: "voided", updatedAt: new Date() }).where(and(eq(signatureRequests.id, id), inFirm(signatureRequests.firmId, actor)));
  }
  await recordAudit(db, { firmId: actor.firmId, actorUserId: actor.userId, action: "signature.void", entityType: "signature_request", entityId: id, metadata: { clientId: req.clientId } });
}

/* ───────── Webhooks ───────── */

const TERMINAL: SignatureStatus[] = ["signed", "declined", "expired", "voided"];

export interface WebhookResult {
  status: 200 | 400 | 401;
  outcome: "processed" | "duplicate" | "ignored" | "rejected";
}

interface WebhookPayload {
  event?: { event_time?: string | number; event_type?: string; event_hash?: string; event_metadata?: { related_signature_id?: string } };
  signature_request?: { signature_request_id?: string };
}

/**
 * Handles one Dropbox Sign callback. Order: parse → verify hash (else 401) → record the event
 * once (duplicate → acknowledge, no changes) → apply. Unknown requests are recorded, nothing changes.
 */
export async function processDropboxSignWebhook(db: Db, rawJson: string, deps: SignatureDeps = {}): Promise<WebhookResult> {
  const provider = prov(deps);
  let payload: WebhookPayload;
  try {
    payload = JSON.parse(rawJson) as WebhookPayload;
  } catch {
    return { status: 400, outcome: "rejected" };
  }
  const ev = payload.event;
  if (!ev || !provider.isConfigured || !provider.verifyEvent(ev)) return { status: 401, outcome: "rejected" };
  const type = String(ev.event_type);
  const providerRequestId = payload.signature_request?.signature_request_id ?? null;
  const occurredAt = Number.isFinite(Number(ev.event_time)) ? new Date(Number(ev.event_time) * 1000) : null;

  const [req] = providerRequestId
    ? await db.select().from(signatureRequests).where(and(eq(signatureRequests.provider, provider.name), eq(signatureRequests.providerRequestId, providerRequestId)))
    : [];

  const inserted = await db
    .insert(signatureEvents)
    .values({
      firmId: req?.firmId ?? null,
      provider: provider.name,
      providerEventKey: String(ev.event_hash),
      eventType: type,
      providerRequestId,
      signatureRequestId: req?.id ?? null,
      occurredAt,
      payload: { eventType: type, relatedSignatureId: ev.event_metadata?.related_signature_id ?? null },
    })
    .onConflictDoNothing()
    .returning({ id: signatureEvents.id });
  if (!inserted.length) return { status: 200, outcome: "duplicate" };
  if (!req || type === "callback_test") return { status: 200, outcome: "ignored" };

  await applyEvent(db, req, type, ev.event_metadata?.related_signature_id ?? null, occurredAt ?? new Date(), deps);
  return { status: 200, outcome: "processed" };
}

type RequestRow = typeof signatureRequests.$inferSelect;

async function applyEvent(db: Db, req: RequestRow, type: string, signatureId: string | null, when: Date, deps: SignatureDeps) {
  const firm = { firmId: req.firmId, userId: null };
  const setReq = (patch: Partial<RequestRow>) => db.update(signatureRequests).set({ ...patch, updatedAt: new Date() }).where(eq(signatureRequests.id, req.id));
  const signerWhere = signatureId ? and(eq(signatureSigners.signatureRequestId, req.id), eq(signatureSigners.providerSignerId, signatureId)) : undefined;
  if (TERMINAL.includes(req.status) && type !== "signature_request_all_signed") return; // never move out of a final state

  switch (type) {
    case "signature_request_viewed":
      if (signerWhere) await db.update(signatureSigners).set({ status: "viewed", viewedAt: when, updatedAt: new Date() }).where(and(signerWhere, inArray(signatureSigners.status, ["pending", "sent"])));
      if (req.status === "sent") await setReq({ status: "viewed" });
      break;
    case "signature_request_signed":
      if (signerWhere) await db.update(signatureSigners).set({ status: "signed", signedAt: when, updatedAt: new Date() }).where(signerWhere);
      await setReq({ status: "partially_signed" });
      break;
    case "signature_request_all_signed":
      await completeRequest(db, req, when, deps);
      return;
    case "signature_request_declined":
      if (signerWhere) await db.update(signatureSigners).set({ status: "declined", declinedAt: when, updatedAt: new Date() }).where(signerWhere);
      await setReq({ status: "declined" });
      break;
    case "signature_request_expired":
      await setReq({ status: "expired" });
      break;
    case "signature_request_canceled":
      await setReq({ status: "voided" });
      break;
    case "signature_request_invalid":
    case "file_error":
      await setReq({ status: "failed", failureReason: type });
      break;
    default:
      return;
  }
  await logActivity(db, firm, { entityType: req.engagementId ? "engagement" : "client", entityId: req.engagementId ?? req.clientId, clientId: req.clientId, type: "system", body: `Signature request “${req.title}”: ${type.replace(/^signature_request_/, "").replace(/_/g, " ")}` });
}

/** Confirms completion with the provider, then stores the signed PDF as a client document linked to the engagement. */
async function completeRequest(db: Db, req: RequestRow, when: Date, deps: SignatureDeps) {
  if (req.status === "signed" && req.signedDocumentId) return;
  const provider = prov(deps);
  const status = await provider.getStatus(req.providerRequestId!);
  if (!status.isComplete) return; // the event alone is not trusted for completion
  const pdf = await provider.downloadSignedPdf(req.providerRequestId!);
  if (pdf.subarray(0, 5).toString("latin1") !== "%PDF-") throw new AppError("The signed file from Dropbox Sign wasn’t a PDF.");

  const storage = deps.storage ?? defaultStorage(db);
  const storageKey = randomUUID();
  await storage.put(storageKey, pdf, "application/pdf");
  const safeTitle = req.title.replace(/[^\w .-]+/g, " ").trim().slice(0, 100) || "document";

  await db.transaction(async (txRaw) => {
    const t = txRaw as unknown as Db;
    const [doc] = await t
      .insert(documents)
      .values({
        firmId: req.firmId,
        clientId: req.clientId,
        engagementId: req.engagementId,
        taxReturnId: req.taxReturnId,
        documentNumber: await nextNumber(t, req.firmId, "document" as CounterKind),
        title: `Signed – ${req.title}`,
        fileName: `${safeTitle} (signed).pdf`,
        contentType: "application/pdf",
        sizeBytes: pdf.length,
        sha256: createHash("sha256").update(pdf).digest("hex"),
        storageKey,
        storageProvider: storage.provider,
        uploadedById: null,
        uploadedByClient: false,
        category: req.documentType === "engagement_letter" ? "engagement_letters" : "contracts",
        status: "uploaded",
        // Staff decide whether to share the signed copy with the client.
        visibility: "internal_only",
        visibleToClient: false,
        description: `Signed through Dropbox Sign${req.testMode ? " (test mode — not legally binding)" : ""}.`,
      })
      .returning({ id: documents.id });
    for (const s of status.signatures) {
      if (s.statusCode === "signed") await t.update(signatureSigners).set({ status: "signed", signedAt: when, updatedAt: new Date() }).where(and(eq(signatureSigners.signatureRequestId, req.id), eq(signatureSigners.providerSignerId, s.signatureId)));
    }
    await t.update(signatureRequests).set({ status: "signed", completedAt: when, signedDocumentId: doc!.id, updatedAt: new Date() }).where(eq(signatureRequests.id, req.id));
    await recordAudit(t, { firmId: req.firmId, actorUserId: null, action: "signature.completed", entityType: "signature_request", entityId: req.id, metadata: { clientId: req.clientId, documentId: doc!.id } });
    await logActivity(t, { firmId: req.firmId, userId: null }, {
      entityType: req.engagementId ? "engagement" : "client",
      entityId: req.engagementId ?? req.clientId,
      clientId: req.clientId,
      type: "system",
      body: `Signed by all parties: ${req.title}${req.testMode ? " (test mode)" : ""}`,
      metadata: { signatureRequestId: req.id, documentId: doc!.id },
    });
  });
}

/* ───────── Client portal ───────── */

export interface PortalSignatureRequest {
  id: string;
  title: string;
  status: SignatureStatus;
  testMode: boolean;
  sentAt: Date | null;
  expiresAt: Date | null;
  completedAt: Date | null;
  signers: { id: string; name: string; status: string; mine: boolean; canOpen: boolean }[];
}

/** The client's own sent requests (drafts never shown). `clientId` must come from requirePortalContext(). */
export async function listPortalSignatureRequests(db: Db, actor: Actor, clientId: string, deps: SignatureDeps = {}): Promise<PortalSignatureRequest[]> {
  await assertPortalClientAccess(db, actor, clientId);
  const provider = prov(deps);
  const rows = await db
    .select({ id: signatureRequests.id, title: signatureRequests.title, status: signatureRequests.status, testMode: signatureRequests.testMode, sentAt: signatureRequests.sentAt, expiresAt: signatureRequests.expiresAt, completedAt: signatureRequests.completedAt })
    .from(signatureRequests)
    .where(and(eq(signatureRequests.firmId, actor.firmId), eq(signatureRequests.clientId, clientId), sql`${signatureRequests.status} <> 'draft'`))
    .orderBy(desc(signatureRequests.createdAt));
  if (!rows.length) return [];
  const signers = await db
    .select({ id: signatureSigners.id, requestId: signatureSigners.signatureRequestId, name: signatureSigners.name, email: signatureSigners.email, status: signatureSigners.status, portalUserId: signatureSigners.portalUserId, providerSignerId: signatureSigners.providerSignerId })
    .from(signatureSigners)
    .where(and(eq(signatureSigners.firmId, actor.firmId), inArray(signatureSigners.signatureRequestId, rows.map((r) => r.id))))
    .orderBy(asc(signatureSigners.signingOrder));
  const me = actor.email.toLowerCase();
  return rows.map((r) => ({
    ...r,
    signers: signers
      .filter((s) => s.requestId === r.id)
      .map((s) => {
        const mine = s.portalUserId === actor.userId || s.email.toLowerCase() === me;
        const open = ["sent", "viewed", "partially_signed"].includes(r.status) && ["sent", "viewed"].includes(s.status);
        return { id: s.id, name: s.name, status: s.status, mine, canOpen: mine && open && provider.embedded && !!s.providerSignerId };
      }),
  }));
}

/** Provider-hosted signing URL for the portal user's OWN pending signature (validated server-side). */
export async function portalSigningUrl(db: Db, actor: Actor, clientId: string, signerId: string, deps: SignatureDeps = {}): Promise<string> {
  await assertPortalClientAccess(db, actor, clientId);
  const provider = prov(deps);
  if (!provider.embedded) throw new AppError("Please use the signing link in the email from Dropbox Sign.");
  if (!isUuid(signerId)) throw new NotFoundError();
  const [row] = await db
    .select({ signer: signatureSigners, req: signatureRequests })
    .from(signatureSigners)
    .innerJoin(signatureRequests, eq(signatureRequests.id, signatureSigners.signatureRequestId))
    .where(and(eq(signatureSigners.id, signerId), eq(signatureRequests.firmId, actor.firmId), eq(signatureRequests.clientId, clientId)));
  if (!row) throw new NotFoundError();
  const mine = row.signer.portalUserId === actor.userId || row.signer.email.toLowerCase() === actor.email.toLowerCase();
  if (!mine || !row.signer.providerSignerId || !["sent", "viewed"].includes(row.signer.status) || TERMINAL.includes(row.req.status)) throw new NotFoundError();
  return provider.embeddedSignUrl(row.signer.providerSignerId);
}
