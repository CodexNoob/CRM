import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "@/db";
import { clients, documents, engagements, users, type DocumentRow } from "@/db/schema";
import type { Actor } from "@/lib/auth/actor";
import { checkFile } from "@/lib/file-rules";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { databaseStorage, noScanner, type FileStorage, type MalwareScanner } from "@/lib/storage";
import { isUuid } from "@/lib/validation";
import { assertClientAccess, visibleClientsCondition } from "./access";
import { recordAudit } from "./audit";

export interface DocumentDeps {
  storage?: FileStorage;
  scanner?: MalwareScanner;
}

export interface DocumentListItem {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  engagementId: string | null;
  engagementTitle: string | null;
  uploadedByName: string | null;
  uploadedByClient: boolean;
  visibleToClient: boolean;
  scanStatus: DocumentRow["scanStatus"];
  createdAt: Date;
}

/** Resolves which client a document goes to and enforces who may upload there. */
async function resolveUploadTarget(db: Db, actor: Actor, clientId: string, engagementId: string | undefined) {
  if (actor.role === "client") {
    if (!actor.clientId || actor.clientId !== clientId) throw new ForbiddenError();
  } else {
    await assertClientAccess(db, actor, clientId);
  }
  if (engagementId) {
    if (!isUuid(engagementId)) throw new ValidationError({ engagementId: ["Choose a valid engagement."] });
    const [e] = await db.select({ clientId: engagements.clientId }).from(engagements).where(eq(engagements.id, engagementId));
    if (!e || e.clientId !== clientId) throw new ValidationError({ engagementId: ["That engagement belongs to a different client."] });
  }
}

export async function uploadDocument(
  db: Db,
  actor: Actor,
  input: { clientId: string; engagementId?: string; visibleToClient?: boolean; fileName: string; data: Buffer },
  deps: DocumentDeps = {},
): Promise<DocumentRow> {
  const storage = deps.storage ?? databaseStorage(db);
  const scanner = deps.scanner ?? noScanner;
  await resolveUploadTarget(db, actor, input.clientId, input.engagementId);
  const { fileName, contentType } = checkFile(input.fileName, input.data);
  const scanStatus = await scanner.scan(input.data, fileName);
  if (scanStatus === "infected") {
    await recordAudit(db, { actorUserId: actor.userId, action: "document.rejected_malware", entityType: "client", entityId: input.clientId });
    throw new ValidationError({ file: ["This file was flagged as unsafe and was not uploaded."] });
  }

  const storageKey = randomUUID();
  await storage.put(storageKey, input.data);
  const isClient = actor.role === "client";
  const [doc] = await db
    .insert(documents)
    .values({
      clientId: input.clientId,
      engagementId: input.engagementId ?? null,
      fileName,
      contentType,
      sizeBytes: input.data.length,
      sha256: createHash("sha256").update(input.data).digest("hex"),
      storageKey,
      uploadedById: actor.userId,
      uploadedByClient: isClient,
      // Clients always see what they uploaded; staff choose per file.
      visibleToClient: isClient ? true : Boolean(input.visibleToClient),
      scanStatus,
    })
    .returning();
  await recordAudit(db, {
    actorUserId: actor.userId,
    action: "document.upload",
    entityType: "document",
    entityId: doc!.id,
    metadata: { clientId: input.clientId, sizeBytes: input.data.length },
  });
  return doc!;
}

const uploader = alias(users, "uploader");

function listQuery(db: Db) {
  return db
    .select({
      id: documents.id,
      fileName: documents.fileName,
      contentType: documents.contentType,
      sizeBytes: documents.sizeBytes,
      engagementId: documents.engagementId,
      engagementTitle: engagements.title,
      uploadedByName: uploader.name,
      uploadedByClient: documents.uploadedByClient,
      visibleToClient: documents.visibleToClient,
      scanStatus: documents.scanStatus,
      createdAt: documents.createdAt,
    })
    .from(documents)
    .leftJoin(engagements, eq(engagements.id, documents.engagementId))
    .leftJoin(uploader, eq(uploader.id, documents.uploadedById));
}

export async function listClientDocuments(db: Db, actor: Actor, clientId: string): Promise<DocumentListItem[]> {
  await assertClientAccess(db, actor, clientId);
  return listQuery(db)
    .where(and(eq(documents.clientId, clientId), isNull(documents.deletedAt)))
    .orderBy(desc(documents.createdAt));
}

/** Most recent documents across every client the staff member can access. */
export async function listRecentDocuments(db: Db, actor: Actor, limit = 100): Promise<(DocumentListItem & { clientId: string; clientName: string })[]> {
  const visible = visibleClientsCondition(db, actor);
  const rows = await db
    .select({
      id: documents.id,
      fileName: documents.fileName,
      contentType: documents.contentType,
      sizeBytes: documents.sizeBytes,
      engagementId: documents.engagementId,
      engagementTitle: engagements.title,
      uploadedByName: uploader.name,
      uploadedByClient: documents.uploadedByClient,
      visibleToClient: documents.visibleToClient,
      scanStatus: documents.scanStatus,
      createdAt: documents.createdAt,
      clientId: clients.id,
      clientName: clients.displayName,
    })
    .from(documents)
    .innerJoin(clients, eq(clients.id, documents.clientId))
    .leftJoin(engagements, eq(engagements.id, documents.engagementId))
    .leftJoin(uploader, eq(uploader.id, documents.uploadedById))
    .where(and(visible, isNull(documents.deletedAt)))
    .orderBy(desc(documents.createdAt))
    .limit(Math.min(limit, 300));
  return rows;
}

/** The client's own shared documents (portal). */
export async function listPortalDocuments(db: Db, actor: Actor): Promise<DocumentListItem[]> {
  if (actor.role !== "client" || !actor.clientId) throw new ForbiddenError();
  return listQuery(db)
    .where(and(eq(documents.clientId, actor.clientId), eq(documents.visibleToClient, true), isNull(documents.deletedAt)))
    .orderBy(desc(documents.createdAt));
}

async function loadAccessibleDocument(db: Db, actor: Actor, id: string): Promise<DocumentRow> {
  if (!isUuid(id)) throw new NotFoundError();
  const [doc] = await db.select().from(documents).where(and(eq(documents.id, id), isNull(documents.deletedAt)));
  if (!doc) throw new NotFoundError();
  if (actor.role === "client") {
    if (!actor.clientId || doc.clientId !== actor.clientId || !doc.visibleToClient) throw new NotFoundError();
  } else {
    await assertClientAccess(db, actor, doc.clientId);
  }
  return doc;
}

export async function getDocumentForDownload(
  db: Db,
  actor: Actor,
  id: string,
  deps: DocumentDeps = {},
): Promise<{ doc: DocumentRow; data: Buffer }> {
  const doc = await loadAccessibleDocument(db, actor, id);
  if (doc.scanStatus === "infected") throw new NotFoundError();
  const data = await (deps.storage ?? databaseStorage(db)).get(doc.storageKey);
  if (!data) throw new NotFoundError();
  await recordAudit(db, { actorUserId: actor.userId, action: "document.download", entityType: "document", entityId: doc.id });
  return { doc, data };
}

export async function setDocumentShared(db: Db, actor: Actor, id: string, shared: boolean): Promise<void> {
  if (actor.role === "client") throw new ForbiddenError();
  const doc = await loadAccessibleDocument(db, actor, id);
  if (doc.uploadedByClient && !shared) throw new ValidationError({ _form: ["Files the client uploaded always stay visible to them."] });
  await db.update(documents).set({ visibleToClient: shared }).where(eq(documents.id, id));
  await recordAudit(db, { actorUserId: actor.userId, action: shared ? "document.share" : "document.unshare", entityType: "document", entityId: id });
}

/** Removes a document from view. The stored bytes are retained per the firm's retention policy. */
export async function archiveDocument(db: Db, actor: Actor, id: string): Promise<void> {
  if (actor.role === "client") throw new ForbiddenError();
  await loadAccessibleDocument(db, actor, id);
  await db.update(documents).set({ deletedAt: new Date() }).where(eq(documents.id, id));
  await recordAudit(db, { actorUserId: actor.userId, action: "document.archive", entityType: "document", entityId: id });
}
