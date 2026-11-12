import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import type { Db } from "@/db";
import {
  activities,
  clients,
  documentRequestItems,
  documents,
  engagements,
  taxPreparationCases,
  taxReturns,
  users,
  type DocumentCategory,
  type DocumentRow,
  type DocumentStatus,
  type DocumentVisibility,
} from "@/db/schema";
import type { Actor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/permissions";
import { checkFile } from "@/lib/file-rules";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { defaultStorage, noScanner, storageFor, type FileStorage, type MalwareScanner } from "@/lib/storage";
import { isUuid, parseInput } from "@/lib/validation";
import { assertClientAccess, inFirm, requirePermission, visibleClientsCondition } from "./access";
import { recordAudit } from "./audit";
import { notifyClientUsers } from "./client-notifications";
import { assertPortalUploadableItem, itemStatusFromDocument, recomputeRequestStatus } from "./document-requests";
import { assertPortalClientAccess, resolvePortalClient } from "./portal-access";
import { logActivity, nextNumber, type CounterKind } from "./timeline";

/**
 * Document management. Files live in private storage (Supabase bucket or the database) and are
 * only reachable through `prepareDownload`, which re-checks access every time.
 *
 * Visibility: internal_only (staff only — the default for staff uploads), client_visible (the client
 * can see it; client uploads), shared_with_client (staff deliberately sent it).
 * Status: uploaded / under_review on upload — NEVER verified automatically. Staff review → verified,
 * rejected, or replacement_requested; a replacement is a new VERSION (old versions are kept).
 * Portal callers must pass the client resolved by requirePortalContext(); a client id from the
 * browser is only accepted after assertPortalClientAccess.
 */

export interface DocumentDeps {
  storage?: FileStorage;
  scanner?: MalwareScanner;
}

export interface DocumentListItem {
  id: string;
  documentNumber: number | null;
  title: string | null;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  category: DocumentCategory;
  status: DocumentStatus;
  visibility: DocumentVisibility;
  versionNumber: number;
  isCurrentVersion: boolean;
  taxYear: number | null;
  engagementId: string | null;
  engagementTitle: string | null;
  documentRequestItemId: string | null;
  uploadedByName: string | null;
  uploadedByClient: boolean;
  visibleToClient: boolean;
  scanStatus: DocumentRow["scanStatus"];
  reviewNote: string | null;
  expirationDate: string | null;
  createdAt: Date;
}

const uploader = alias(users, "uploader");
const reviewer = alias(users, "reviewer");

function listColumns() {
  return {
    id: documents.id,
    documentNumber: documents.documentNumber,
    title: documents.title,
    fileName: documents.fileName,
    contentType: documents.contentType,
    sizeBytes: documents.sizeBytes,
    category: documents.category,
    status: documents.status,
    visibility: documents.visibility,
    versionNumber: documents.versionNumber,
    isCurrentVersion: documents.isCurrentVersion,
    taxYear: documents.taxYear,
    engagementId: documents.engagementId,
    engagementTitle: engagements.title,
    documentRequestItemId: documents.documentRequestItemId,
    uploadedByName: uploader.name,
    uploadedByClient: documents.uploadedByClient,
    visibleToClient: documents.visibleToClient,
    scanStatus: documents.scanStatus,
    reviewNote: documents.reviewNote,
    expirationDate: documents.expirationDate,
    createdAt: documents.createdAt,
  };
}

/* ───────── Validation ───────── */

const CATEGORIES = documents.category.enumValues;
const VISIBILITIES = documents.visibility.enumValues;
const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const optUuid = (label: string) => z.preprocess(blank, z.uuid(`Choose a valid ${label}.`).optional());
const optYear = z.preprocess(blank, z.coerce.number().int("Enter a year.").min(2000, "Enter a year from 2000.").max(2100, "Enter a year before 2100.").optional());
const optDate = z.preprocess(blank, z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use the format YYYY-MM-DD.").optional());

const metadataSchema = z.object({
  title: z.preprocess(blank, z.string().trim().max(200).optional()),
  category: z.enum(CATEGORIES, { error: "Choose a category." }).default("other"),
  description: z.preprocess(blank, z.string().trim().max(2000).optional()),
  internalNotes: z.preprocess(blank, z.string().trim().max(5000).optional()),
  taxYear: optYear,
  expirationDate: optDate,
  engagementId: optUuid("engagement"),
  taxPreparationCaseId: optUuid("tax preparation case"),
  taxReturnId: optUuid("tax return"),
});

/** Engagement / tax case / tax return links must belong to the same client (and firm). */
async function assertLinks(db: Db, actor: Actor, clientId: string, l: { engagementId?: string | null; taxPreparationCaseId?: string | null; taxReturnId?: string | null }) {
  if (l.engagementId) {
    if (!isUuid(l.engagementId)) throw new ValidationError({ engagementId: ["Choose a valid engagement."] });
    const [e] = await db.select({ clientId: engagements.clientId }).from(engagements).where(and(eq(engagements.id, l.engagementId), inFirm(engagements.firmId, actor)));
    if (!e || e.clientId !== clientId) throw new ValidationError({ engagementId: ["That engagement belongs to a different client."] });
  }
  if (l.taxPreparationCaseId) {
    const [c] = await db.select({ clientId: taxPreparationCases.clientId }).from(taxPreparationCases).where(and(eq(taxPreparationCases.id, l.taxPreparationCaseId), inFirm(taxPreparationCases.firmId, actor)));
    if (!c || c.clientId !== clientId) throw new ValidationError({ taxPreparationCaseId: ["That tax preparation case belongs to a different client."] });
  }
  if (l.taxReturnId) {
    const [r] = await db.select({ clientId: taxReturns.clientId }).from(taxReturns).where(and(eq(taxReturns.id, l.taxReturnId), inFirm(taxReturns.firmId, actor)));
    if (!r || r.clientId !== clientId) throw new ValidationError({ taxReturnId: ["That tax return belongs to a different client."] });
  }
}

const docActivity = (db: Db, actor: Actor, doc: Pick<DocumentRow, "id" | "clientId" | "title" | "fileName">, body: string, extra: Record<string, unknown> = {}) =>
  logActivity(db, actor, { entityType: "client", entityId: doc.clientId, clientId: doc.clientId, type: "system", body: `${body}: ${doc.title ?? doc.fileName}`, metadata: { documentId: doc.id, ...extra } });

/* ───────── Upload ───────── */

export interface UploadInput {
  clientId: string;
  engagementId?: string;
  /** Must already be validated by the caller (services/tasks.ts) as a task of this client. */
  taskId?: string;
  /** Back-compat flag: true = shared_with_client. Prefer `visibility`. */
  visibleToClient?: boolean;
  visibility?: DocumentVisibility;
  category?: DocumentCategory;
  title?: string;
  description?: string;
  taxYear?: number;
  taxPreparationCaseId?: string;
  taxReturnId?: string;
  /** A document request item this upload fulfils (portal or staff). */
  requestItemId?: string;
  fileName: string;
  data: Buffer;
}

/** Stores the bytes (private storage) and returns the storage fields for a document row. */
async function storeFile(db: Db, actor: Actor, clientId: string, fileName: string, data: Buffer, deps: DocumentDeps) {
  const storage = deps.storage ?? defaultStorage(db);
  const scanner = deps.scanner ?? noScanner;
  const checked = checkFile(fileName, data);
  const scanStatus = await scanner.scan(data, checked.fileName);
  if (scanStatus === "infected") {
    await recordAudit(db, { firmId: actor.firmId, actorUserId: actor.userId, action: "document.rejected_malware", entityType: "client", entityId: clientId });
    throw new ValidationError({ file: ["This file was flagged as unsafe and was not uploaded."] });
  }
  // Keys are random and namespaced per firm/client; they are never shown to browsers.
  const storageKey = `${actor.firmId}/${clientId}/${randomUUID()}`;
  await storage.put(storageKey, data, checked.contentType);
  return {
    fileName: checked.fileName,
    contentType: checked.contentType,
    sizeBytes: data.length,
    sha256: createHash("sha256").update(data).digest("hex"),
    storageKey,
    storageProvider: storage.provider,
    scanStatus,
  };
}

/** Links an uploaded document to its request item and refreshes the request status. */
async function fulfilItem(db: Db, actor: Actor, itemId: string, docId: string) {
  const [item] = await db.select({ requestId: documentRequestItems.requestId }).from(documentRequestItems).where(and(eq(documentRequestItems.id, itemId), inFirm(documentRequestItems.firmId, actor)));
  if (!item) return;
  await db.update(documentRequestItems).set({ fulfilledDocumentId: docId, status: "under_review", updatedAt: new Date() }).where(and(eq(documentRequestItems.id, itemId), inFirm(documentRequestItems.firmId, actor)));
  await recomputeRequestStatus(db, actor.firmId, item.requestId);
}

export async function uploadDocument(db: Db, actor: Actor, input: UploadInput, deps: DocumentDeps = {}): Promise<DocumentRow> {
  const isClient = actor.role === "client";
  if (isClient) {
    // A portal user may only upload for a client listed in their portal access.
    await assertPortalClientAccess(db, actor, input.clientId).catch(() => {
      throw new ForbiddenError();
    });
    if (input.taskId || input.taxPreparationCaseId || input.taxReturnId) throw new ForbiddenError();
  } else {
    requirePermission(actor, "documents", "upload");
    await assertClientAccess(db, actor, input.clientId);
  }
  await assertLinks(db, actor, input.clientId, input);

  let item: Awaited<ReturnType<typeof assertPortalUploadableItem>> | null = null;
  if (input.requestItemId) {
    if (isClient) item = await assertPortalUploadableItem(db, actor, input.clientId, input.requestItemId);
    else {
      if (!isUuid(input.requestItemId)) throw new NotFoundError();
      const [row] = await db.select({ itemId: documentRequestItems.id }).from(documentRequestItems).where(and(eq(documentRequestItems.id, input.requestItemId), inFirm(documentRequestItems.firmId, actor)));
      if (!row) throw new NotFoundError();
    }
  }
  // A client re-uploading for an item that already has a (rejected) file sends a new VERSION.
  if (item?.item.fulfilledDocumentId) {
    return uploadNewVersion(db, actor, item.item.fulfilledDocumentId, { fileName: input.fileName, data: input.data }, deps, input.clientId);
  }

  const stored = await storeFile(db, actor, input.clientId, input.fileName, input.data, deps);
  const visibility: DocumentVisibility = isClient ? "client_visible" : (input.visibility ?? (input.visibleToClient ? "shared_with_client" : "internal_only"));
  const status: DocumentStatus = input.requestItemId ? "under_review" : "uploaded";
  return db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Db;
    const [doc] = await tx
      .insert(documents)
      .values({
        firmId: actor.firmId,
        clientId: input.clientId,
        engagementId: input.engagementId ?? null,
        taskId: input.taskId ?? null,
        taxPreparationCaseId: input.taxPreparationCaseId ?? null,
        taxReturnId: input.taxReturnId ?? null,
        documentRequestItemId: input.requestItemId ?? null,
        documentNumber: await nextNumber(tx, actor.firmId, "document" as CounterKind),
        title: input.title?.trim().slice(0, 200) || stored.fileName,
        description: input.description?.slice(0, 2000) ?? null,
        category: input.category ?? (item ? item.item.category : "other"),
        taxYear: input.taxYear ?? null,
        status,
        visibility,
        visibleToClient: visibility !== "internal_only",
        ...stored,
        uploadedById: actor.userId,
        uploadedByClient: isClient,
      })
      .returning();
    if (input.requestItemId) await fulfilItem(tx, actor, input.requestItemId, doc!.id);
    await recordAudit(tx, { firmId: actor.firmId, actorUserId: actor.userId, action: "document.upload", entityType: "document", entityId: doc!.id, metadata: { clientId: input.clientId, sizeBytes: stored.sizeBytes } });
    await docActivity(tx, actor, doc!, isClient ? "Client uploaded" : "Uploaded");
    if (visibility === "shared_with_client") {
      await notifyClientUsers(tx, actor.firmId, input.clientId, { type: "document_shared", title: `New document: ${doc!.title}`, href: "/portal/documents", dedupeKey: `docshare:${doc!.id}` });
    }
    return doc!;
  });
}

/**
 * Uploads a replacement as a NEW version. The previous version is kept (not overwritten), the
 * version number increments, root/previous links are set, and only the new one is "current".
 * Portal users may replace only their own client's visible documents that staff rejected or asked to replace.
 */
export async function uploadNewVersion(
  db: Db,
  actor: Actor,
  previousId: string,
  file: { fileName: string; data: Buffer },
  deps: DocumentDeps = {},
  portalClientId?: string,
): Promise<DocumentRow> {
  const isClient = actor.role === "client";
  const prev = isClient ? await loadForPortal(db, actor, portalClientId ?? (await resolvePortalClient(db, actor)).clientId, previousId) : await loadForStaff(db, actor, previousId);
  if (isClient) {
    if (prev.status !== "rejected" && prev.status !== "replacement_requested") throw new ValidationError({ file: ["This document hasn’t been sent back for a new copy."] });
  } else requirePermission(actor, "documents", "upload");
  if (!prev.isCurrentVersion) throw new ValidationError({ file: ["Replace the latest version of this document."] });
  const rootId = prev.rootDocumentId ?? prev.id;
  const stored = await storeFile(db, actor, prev.clientId, file.fileName, file.data, deps);
  return db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Db;
    const [{ max }] = (await tx
      .select({ max: sql<number>`coalesce(max(${documents.versionNumber}), 1)::int` })
      .from(documents)
      .where(and(inFirm(documents.firmId, actor), or(eq(documents.id, rootId), eq(documents.rootDocumentId, rootId))))) as [{ max: number }];
    await tx.update(documents).set({ isCurrentVersion: false, updatedAt: new Date() }).where(and(eq(documents.id, prev.id), inFirm(documents.firmId, actor)));
    const [doc] = await tx
      .insert(documents)
      .values({
        firmId: actor.firmId,
        clientId: prev.clientId,
        engagementId: prev.engagementId,
        taskId: prev.taskId,
        taxPreparationCaseId: prev.taxPreparationCaseId,
        taxReturnId: prev.taxReturnId,
        documentRequestItemId: prev.documentRequestItemId,
        documentNumber: prev.documentNumber,
        versionNumber: max + 1,
        rootDocumentId: rootId,
        previousVersionId: prev.id,
        isCurrentVersion: true,
        title: prev.title,
        description: prev.description,
        category: prev.category,
        taxYear: prev.taxYear,
        expirationDate: prev.expirationDate,
        internalNotes: prev.internalNotes,
        status: prev.documentRequestItemId ? "under_review" : "uploaded",
        // A client's replacement is always visible to them; staff keep the previous visibility.
        visibility: isClient && prev.visibility === "internal_only" ? "client_visible" : prev.visibility,
        visibleToClient: isClient ? true : prev.visibleToClient,
        ...stored,
        uploadedById: actor.userId,
        uploadedByClient: isClient,
      })
      .returning();
    if (prev.documentRequestItemId) await fulfilItem(tx, actor, prev.documentRequestItemId, doc!.id);
    await recordAudit(tx, { firmId: actor.firmId, actorUserId: actor.userId, action: "document.new_version", entityType: "document", entityId: doc!.id, metadata: { clientId: prev.clientId, previousVersionId: prev.id, version: max + 1 } });
    await docActivity(tx, actor, doc!, `${isClient ? "Client uploaded" : "Uploaded"} version ${max + 1}`, { previousVersionId: prev.id });
    return doc!;
  });
}

/* ───────── Loading with access checks ───────── */

async function loadForStaff(db: Db, actor: Actor, id: string, opts: { includeArchived?: boolean } = {}): Promise<DocumentRow> {
  if (actor.role === "client") throw new ForbiddenError();
  if (!isUuid(id)) throw new NotFoundError();
  const [doc] = await db.select().from(documents).where(and(eq(documents.id, id), inFirm(documents.firmId, actor), opts.includeArchived ? undefined : isNull(documents.deletedAt)));
  if (!doc) throw new NotFoundError();
  await assertClientAccess(db, actor, doc.clientId);
  return doc;
}

/** A document the portal user may see: their client, visible to clients, not archived. */
async function loadForPortal(db: Db, actor: Actor, clientId: string, id: string): Promise<DocumentRow> {
  await assertPortalClientAccess(db, actor, clientId);
  if (!isUuid(id)) throw new NotFoundError();
  const [doc] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, id), inFirm(documents.firmId, actor), eq(documents.clientId, clientId), isNull(documents.deletedAt), sql`${documents.visibility} <> 'internal_only'`));
  if (!doc) throw new NotFoundError();
  return doc;
}

/** Resolves the document for any actor (staff or portal), applying the matching access rules. */
async function loadAccessibleDocument(db: Db, actor: Actor, id: string, portalClientId?: string): Promise<DocumentRow> {
  if (actor.role !== "client") return loadForStaff(db, actor, id);
  if (portalClientId) return loadForPortal(db, actor, portalClientId, id);
  // No client given: the document must belong to one of the user's active clients.
  if (!isUuid(id)) throw new NotFoundError();
  const [row] = await db.select({ clientId: documents.clientId }).from(documents).where(and(eq(documents.id, id), inFirm(documents.firmId, actor)));
  if (!row) throw new NotFoundError();
  return loadForPortal(db, actor, row.clientId, id);
}

/* ───────── Lists ───────── */

export interface DocumentFilters {
  q?: string;
  clientId?: string;
  category?: DocumentCategory;
  status?: DocumentStatus;
  engagementId?: string;
  taxYear?: number;
  visibility?: DocumentVisibility;
  /** Default true: only the latest version of each document. */
  currentOnly?: boolean;
  includeArchived?: boolean;
}

export type StaffDocumentRow = DocumentListItem & { clientId: string; clientName: string };

/** Staff document list across every client the actor may see. */
export async function listDocuments(db: Db, actor: Actor, f: DocumentFilters = {}, limit = 500): Promise<StaffDocumentRow[]> {
  requirePermission(actor, "documents", "view");
  const q = f.q?.trim().slice(0, 100);
  const like = q ? `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : undefined;
  return db
    .select({ ...listColumns(), clientId: clients.id, clientName: clients.displayName })
    .from(documents)
    .innerJoin(clients, eq(clients.id, documents.clientId))
    .leftJoin(engagements, and(eq(engagements.id, documents.engagementId), eq(engagements.firmId, documents.firmId)))
    .leftJoin(uploader, and(eq(uploader.id, documents.uploadedById), eq(uploader.firmId, documents.firmId)))
    .where(
      and(
        inFirm(documents.firmId, actor),
        visibleClientsCondition(db, actor),
        f.includeArchived || f.status === "archived" ? undefined : isNull(documents.deletedAt),
        f.currentOnly === false ? undefined : eq(documents.isCurrentVersion, true),
        like ? or(ilike(documents.title, like), ilike(documents.fileName, like), ilike(clients.displayName, like)) : undefined,
        f.clientId && isUuid(f.clientId) ? eq(documents.clientId, f.clientId) : undefined,
        f.category ? eq(documents.category, f.category) : undefined,
        f.status ? eq(documents.status, f.status) : undefined,
        f.engagementId && isUuid(f.engagementId) ? eq(documents.engagementId, f.engagementId) : undefined,
        f.taxYear ? eq(documents.taxYear, f.taxYear) : undefined,
        f.visibility ? eq(documents.visibility, f.visibility) : undefined,
      ),
    )
    .orderBy(desc(documents.createdAt))
    .limit(Math.min(limit, 1000));
}

export async function listClientDocuments(db: Db, actor: Actor, clientId: string): Promise<DocumentListItem[]> {
  await assertClientAccess(db, actor, clientId);
  return db
    .select(listColumns())
    .from(documents)
    .leftJoin(engagements, and(eq(engagements.id, documents.engagementId), eq(engagements.firmId, documents.firmId)))
    .leftJoin(uploader, and(eq(uploader.id, documents.uploadedById), eq(uploader.firmId, documents.firmId)))
    .where(and(inFirm(documents.firmId, actor), eq(documents.clientId, clientId), isNull(documents.deletedAt), eq(documents.isCurrentVersion, true)))
    .orderBy(desc(documents.createdAt));
}

/** Most recent documents across every client the staff member can access. */
export async function listRecentDocuments(db: Db, actor: Actor, limit = 100): Promise<StaffDocumentRow[]> {
  return listDocuments(db, actor, {}, Math.min(limit, 300));
}

/**
 * The portal's documents for one client: client-visible and shared documents (latest versions,
 * not archived). Internal-only documents and internal notes are never selected.
 * Without `clientId`, uses the user's resolved portal client (server-side).
 */
export async function listPortalDocuments(db: Db, actor: Actor, clientId?: string): Promise<DocumentListItem[]> {
  if (actor.role !== "client") throw new ForbiddenError();
  const cid = clientId ? (await assertPortalClientAccess(db, actor, clientId)).clientId : (await resolvePortalClient(db, actor)).clientId;
  return db
    .select(listColumns())
    .from(documents)
    .leftJoin(engagements, and(eq(engagements.id, documents.engagementId), eq(engagements.firmId, documents.firmId)))
    .leftJoin(uploader, and(eq(uploader.id, documents.uploadedById), eq(uploader.firmId, documents.firmId)))
    .where(and(inFirm(documents.firmId, actor), eq(documents.clientId, cid), isNull(documents.deletedAt), eq(documents.isCurrentVersion, true), sql`${documents.visibility} <> 'internal_only'`))
    .orderBy(desc(documents.createdAt));
}

/* ───────── Detail, versions, activity ───────── */

export interface DocumentDetail {
  doc: DocumentRow;
  clientName: string;
  engagementTitle: string | null;
  uploadedByName: string | null;
  reviewedByName: string | null;
  versions: (Pick<DocumentRow, "id" | "versionNumber" | "fileName" | "sizeBytes" | "status" | "isCurrentVersion" | "uploadedByClient" | "createdAt" | "reviewNote"> & { uploadedByName: string | null })[];
  activity: { id: string; body: string | null; actorName: string | null; occurredAt: Date }[];
}

export async function getDocumentDetail(db: Db, actor: Actor, id: string): Promise<DocumentDetail> {
  requirePermission(actor, "documents", "view");
  const doc = await loadForStaff(db, actor, id, { includeArchived: true });
  const rootId = doc.rootDocumentId ?? doc.id;
  const [names] = await db
    .select({ clientName: clients.displayName, engagementTitle: engagements.title, uploadedByName: uploader.name, reviewedByName: reviewer.name })
    .from(documents)
    .innerJoin(clients, eq(clients.id, documents.clientId))
    .leftJoin(engagements, and(eq(engagements.id, documents.engagementId), eq(engagements.firmId, documents.firmId)))
    .leftJoin(uploader, eq(uploader.id, documents.uploadedById))
    .leftJoin(reviewer, eq(reviewer.id, documents.reviewedById))
    .where(eq(documents.id, doc.id));
  const versions = await db
    .select({
      id: documents.id,
      versionNumber: documents.versionNumber,
      fileName: documents.fileName,
      sizeBytes: documents.sizeBytes,
      status: documents.status,
      isCurrentVersion: documents.isCurrentVersion,
      uploadedByClient: documents.uploadedByClient,
      createdAt: documents.createdAt,
      reviewNote: documents.reviewNote,
      uploadedByName: uploader.name,
    })
    .from(documents)
    .leftJoin(uploader, eq(uploader.id, documents.uploadedById))
    .where(and(inFirm(documents.firmId, actor), or(eq(documents.id, rootId), eq(documents.rootDocumentId, rootId))))
    .orderBy(desc(documents.versionNumber));
  const versionIds = versions.map((v) => v.id);
  const activity = await db
    .select({ id: activities.id, body: activities.body, actorName: users.name, occurredAt: activities.occurredAt })
    .from(activities)
    .leftJoin(users, eq(users.id, activities.actorId))
    .where(and(eq(activities.firmId, actor.firmId), eq(activities.clientId, doc.clientId), sql`${activities.metadata} ->> 'documentId' = any(${sql.raw(`array[${versionIds.map((v) => `'${v}'`).join(",") || "''"}]`)}::text[])`))
    .orderBy(desc(activities.occurredAt))
    .limit(100);
  return {
    doc,
    clientName: names?.clientName ?? "",
    engagementTitle: names?.engagementTitle ?? null,
    uploadedByName: names?.uploadedByName ?? null,
    reviewedByName: names?.reviewedByName ?? null,
    versions,
    activity,
  };
}

/** Version history, newest first (staff). */
export async function listDocumentVersions(db: Db, actor: Actor, id: string) {
  return (await getDocumentDetail(db, actor, id)).versions;
}

/* ───────── Metadata, review, sharing, archive ───────── */

export async function updateDocumentMetadata(db: Db, actor: Actor, id: string, input: unknown): Promise<void> {
  requirePermission(actor, "documents", "edit");
  const doc = await loadForStaff(db, actor, id);
  const d = parseInput(metadataSchema, input);
  await assertLinks(db, actor, doc.clientId, d);
  const next = {
    title: d.title ?? doc.fileName,
    category: d.category,
    description: d.description ?? null,
    internalNotes: d.internalNotes ?? null,
    taxYear: d.taxYear ?? null,
    expirationDate: d.expirationDate ?? null,
    engagementId: d.engagementId ?? null,
    taxPreparationCaseId: d.taxPreparationCaseId ?? null,
    taxReturnId: d.taxReturnId ?? null,
  };
  const changed = (Object.keys(next) as (keyof typeof next)[]).filter((k) => next[k] !== doc[k]);
  if (!changed.length) return;
  await db.update(documents).set({ ...next, updatedAt: new Date() }).where(and(eq(documents.id, id), inFirm(documents.firmId, actor)));
  // Record which fields changed — never their values (internal notes stay out of logs).
  await recordAudit(db, { firmId: actor.firmId, actorUserId: actor.userId, action: "document.update", entityType: "document", entityId: id, metadata: { changedFields: changed } });
  await docActivity(db, actor, doc, "Details updated", { changedFields: changed });
}

export type ReviewAction = "start_review" | "verify" | "reject" | "request_replacement";

const REVIEW: Record<ReviewAction, { perm: "review" | "verify" | "reject"; status: DocumentStatus; label: string }> = {
  start_review: { perm: "review", status: "under_review", label: "Review started" },
  verify: { perm: "verify", status: "verified", label: "Verified" },
  reject: { perm: "reject", status: "rejected", label: "Rejected" },
  request_replacement: { perm: "reject", status: "replacement_requested", label: "Replacement requested" },
};

/**
 * Review decisions. Verify records the reviewer and time. Reject / request replacement need a
 * reason (shown to the client as the review note) and notify the client when the document is visible.
 * The linked request item follows the document's status.
 */
export async function reviewDocument(db: Db, actor: Actor, id: string, action: ReviewAction, note?: string): Promise<void> {
  const r = REVIEW[action];
  if (!r) throw new ValidationError({ action: ["Choose a review action."] });
  requirePermission(actor, "documents", r.perm);
  const doc = await loadForStaff(db, actor, id);
  if (!doc.isCurrentVersion) throw new ValidationError({ _form: ["Review the latest version of this document."] });
  const reason = note?.trim().slice(0, 1000) || null;
  if ((action === "reject" || action === "request_replacement") && !reason) throw new ValidationError({ note: ["Say what’s wrong so the client knows what to send."] });
  if (doc.status === r.status && action !== "request_replacement") return;
  const now = new Date();
  await db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Db;
    await tx
      .update(documents)
      .set({
        status: r.status,
        reviewedById: action === "start_review" ? doc.reviewedById : actor.userId,
        reviewedAt: action === "start_review" ? doc.reviewedAt : now,
        reviewNote: action === "reject" || action === "request_replacement" ? reason : action === "verify" ? null : doc.reviewNote,
        updatedAt: now,
      })
      .where(and(eq(documents.id, id), inFirm(documents.firmId, actor)));
    if (doc.documentRequestItemId) {
      const itemStatus = itemStatusFromDocument(r.status);
      const [item] = await tx
        .update(documentRequestItems)
        .set({ ...(itemStatus ? { status: itemStatus } : {}), fulfilledDocumentId: doc.id, updatedAt: now })
        .where(and(eq(documentRequestItems.id, doc.documentRequestItemId), inFirm(documentRequestItems.firmId, actor)))
        .returning({ requestId: documentRequestItems.requestId });
      if (item) await recomputeRequestStatus(tx, actor.firmId, item.requestId);
    }
    await recordAudit(tx, { firmId: actor.firmId, actorUserId: actor.userId, action: `document.${action}`, entityType: "document", entityId: id, metadata: { clientId: doc.clientId } });
    await docActivity(tx, actor, doc, r.label, { status: r.status });
    if ((action === "reject" || action === "request_replacement") && doc.visibility !== "internal_only") {
      await notifyClientUsers(tx, actor.firmId, doc.clientId, {
        type: "document_review",
        title: `Please send a new copy: ${doc.title ?? doc.fileName}`,
        href: "/portal/documents",
        dedupeKey: `docreview:${doc.id}:${action}:${now.getTime()}`,
      });
    }
  });
}

/** Changes who can see a document. Client uploads always stay visible to the client. */
export async function setDocumentVisibility(db: Db, actor: Actor, id: string, visibility: DocumentVisibility): Promise<void> {
  requirePermission(actor, "documents", "share");
  if (!VISIBILITIES.includes(visibility)) throw new ValidationError({ visibility: ["Choose a visibility."] });
  const doc = await loadForStaff(db, actor, id);
  if (doc.uploadedByClient && visibility === "internal_only") throw new ValidationError({ _form: ["Files the client uploaded always stay visible to them."] });
  if (doc.visibility === visibility) return;
  await db.update(documents).set({ visibility, visibleToClient: visibility !== "internal_only", updatedAt: new Date() }).where(and(eq(documents.id, id), inFirm(documents.firmId, actor)));
  await recordAudit(db, { firmId: actor.firmId, actorUserId: actor.userId, action: visibility === "internal_only" ? "document.unshare" : "document.share", entityType: "document", entityId: id });
  await docActivity(db, actor, doc, visibility === "internal_only" ? "Made internal" : "Shared with client");
  if (visibility !== "internal_only") {
    await notifyClientUsers(db, actor.firmId, doc.clientId, { type: "document_shared", title: `New document: ${doc.title ?? doc.fileName}`, href: "/portal/documents", dedupeKey: `docshare:${doc.id}` });
  }
}

/** Back-compat: shared = shared_with_client, not shared = internal_only. */
export async function setDocumentShared(db: Db, actor: Actor, id: string, shared: boolean): Promise<void> {
  if (actor.role === "client") throw new ForbiddenError();
  await setDocumentVisibility(db, actor, id, shared ? "shared_with_client" : "internal_only");
}

/** Archives a document (hidden from staff lists and the portal). The bytes are retained per the firm's retention policy. */
export async function archiveDocument(db: Db, actor: Actor, id: string): Promise<void> {
  if (actor.role === "client") throw new ForbiddenError();
  requirePermission(actor, "documents", "archive");
  const doc = await loadForStaff(db, actor, id);
  await db.update(documents).set({ deletedAt: new Date(), status: "archived", updatedAt: new Date() }).where(and(eq(documents.id, id), inFirm(documents.firmId, actor)));
  await recordAudit(db, { firmId: actor.firmId, actorUserId: actor.userId, action: "document.archive", entityType: "document", entityId: id });
  await docActivity(db, actor, doc, "Archived");
}

/* ───────── Download / preview ───────── */

const INLINE_TYPES = new Set(["application/pdf", "image/png", "image/jpeg"]);

export type PreparedDownload = { doc: DocumentRow; inline: boolean } & ({ kind: "redirect"; url: string } | { kind: "bytes"; data: Buffer });

/**
 * The single gate for file contents. Staff need documents:download (read-only users can see that a
 * file exists but not open it); portal users need access to the document's client and a visible,
 * non-archived document. Returns a short-lived signed URL (private bucket) or the bytes.
 * `inline` is honoured only for PDFs and images.
 */
export async function prepareDownload(
  db: Db,
  actor: Actor,
  id: string,
  opts: { inline?: boolean; portalClientId?: string } = {},
  deps: DocumentDeps = {},
): Promise<PreparedDownload> {
  if (actor.role !== "client" && !can(actor, "documents", "download")) throw new ForbiddenError("Your role can’t open document files.");
  const doc = await loadAccessibleDocument(db, actor, id, opts.portalClientId);
  if (doc.scanStatus === "infected") throw new NotFoundError();
  const inline = !!opts.inline && INLINE_TYPES.has(doc.contentType);
  const storage = deps.storage ?? storageFor(db, doc.storageProvider);
  await recordAudit(db, { firmId: actor.firmId, actorUserId: actor.userId, action: inline ? "document.preview" : "document.download", entityType: "document", entityId: doc.id, metadata: { clientId: doc.clientId } });
  if (!inline) {
    const url = await storage.signedUrl(doc.storageKey, { fileName: doc.fileName, expiresInSeconds: 60 });
    if (url) return { doc, inline, kind: "redirect", url };
  }
  const data = await storage.get(doc.storageKey);
  if (!data) throw new NotFoundError();
  return { doc, inline, kind: "bytes", data };
}

/** Back-compat: bytes of an accessible document. */
export async function getDocumentForDownload(db: Db, actor: Actor, id: string, deps: DocumentDeps = {}): Promise<{ doc: DocumentRow; data: Buffer }> {
  if (actor.role !== "client" && !can(actor, "documents", "download")) throw new ForbiddenError("Your role can’t open document files.");
  const doc = await loadAccessibleDocument(db, actor, id);
  if (doc.scanStatus === "infected") throw new NotFoundError();
  const data = await (deps.storage ?? storageFor(db, doc.storageProvider)).get(doc.storageKey);
  if (!data) throw new NotFoundError();
  await recordAudit(db, { firmId: actor.firmId, actorUserId: actor.userId, action: "document.download", entityType: "document", entityId: doc.id });
  return { doc, data };
}

/* ───────── Pickers ───────── */

/** Engagements, tax cases and tax returns of a client, for the link pickers. */
export async function listDocumentLinkOptions(db: Db, actor: Actor, clientId: string) {
  await assertClientAccess(db, actor, clientId);
  const [eng, cases, returns] = await Promise.all([
    db.select({ id: engagements.id, title: engagements.title }).from(engagements).where(and(inFirm(engagements.firmId, actor), eq(engagements.clientId, clientId))).orderBy(desc(engagements.createdAt)),
    db.select({ id: taxPreparationCases.id, taxYear: taxPreparationCases.taxYear, form: taxPreparationCases.taxFormType }).from(taxPreparationCases).where(and(inFirm(taxPreparationCases.firmId, actor), eq(taxPreparationCases.clientId, clientId))).orderBy(desc(taxPreparationCases.taxYear)),
    db.select({ id: taxReturns.id, number: taxReturns.returnNumber, taxYear: taxReturns.taxYear }).from(taxReturns).where(and(inFirm(taxReturns.firmId, actor), eq(taxReturns.clientId, clientId))).orderBy(desc(taxReturns.taxYear)),
  ]);
  return { engagements: eng, taxCases: cases, taxReturns: returns };
}

