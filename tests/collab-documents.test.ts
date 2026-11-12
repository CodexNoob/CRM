import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { DbHandle } from "@/db";
import { clientNotifications, documentRequests } from "@/db/schema";
import type { Actor } from "@/lib/auth/actor";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import type { FileStorage } from "@/lib/storage";
import {
  createDocumentRequest,
  getDocumentRequest,
  listPortalDocumentRequests,
  sendDocumentRequest,
  waiveRequestItem,
} from "@/services/document-requests";
import {
  archiveDocument,
  getDocumentDetail,
  listDocuments,
  listPortalDocuments,
  prepareDownload,
  reviewDocument,
  setDocumentVisibility,
  updateDocumentMetadata,
  uploadDocument,
  uploadNewVersion,
} from "@/services/documents";
import { createClientWithPortalUser, createTestDb, createUser } from "./helpers";

/** Document management on real services + Postgres, with an in-memory private store (no network). */

const PDF = Buffer.from("%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");
const PDF2 = Buffer.from("%PDF-1.7\n% second copy\n%%EOF");

/** Fake private bucket: signs URLs, so downloads redirect instead of streaming. */
function memoryBucket() {
  const files = new Map<string, Buffer>();
  const storage: FileStorage = {
    provider: "supabase",
    async put(key, data) {
      if (files.has(key)) throw new Error("no overwrite");
      files.set(key, data);
    },
    async get(key) {
      return files.get(key) ?? null;
    },
    async signedUrl(key) {
      return files.has(key) ? `https://bucket.test/signed/${encodeURIComponent(key)}?token=short-lived` : null;
    },
  };
  return { storage, files };
}

let h: DbHandle;
let manager: Actor, employee: Actor, readOnly: Actor, portalA: Actor, portalB: Actor;
let clientA: string, clientB: string;
const bucket = memoryBucket();
const deps = { storage: bucket.storage };

beforeAll(async () => {
  h = await createTestDb();
  await createUser(h.db, { role: "admin" });
  manager = await createUser(h.db, { role: "manager" });
  employee = await createUser(h.db, { role: "employee" });
  readOnly = await createUser(h.db, { role: "read_only" });
  const a = await createClientWithPortalUser(h.db, manager, "John Smith");
  const b = await createClientWithPortalUser(h.db, manager, "Other Client");
  clientA = a.client.id;
  clientB = b.client.id;
  portalA = a.portalUser;
  portalB = b.portalUser;
});
afterAll(async () => {
  await h.close();
});

describe("upload and metadata", () => {
  it("stores the file privately with metadata; staff uploads default to internal only and are never verified", async () => {
    const doc = await uploadDocument(h.db, manager, { clientId: clientA, fileName: "workpaper.pdf", data: PDF, category: "financial_reports", taxYear: 2026 }, deps);
    expect(doc).toMatchObject({ visibility: "internal_only", visibleToClient: false, status: "uploaded", category: "financial_reports", versionNumber: 1, isCurrentVersion: true, storageProvider: "supabase", taxYear: 2026 });
    expect(doc.documentNumber).toBe(1);
    expect(doc.storageKey.startsWith(`${manager.firmId}/${clientA}/`)).toBe(true);
    expect(bucket.files.has(doc.storageKey)).toBe(true);

    await updateDocumentMetadata(h.db, manager, doc.id, { title: "2026 trial balance", category: "financial_reports", internalNotes: "Draft – do not share", taxYear: "2026" });
    const d = await getDocumentDetail(h.db, manager, doc.id);
    expect(d.doc).toMatchObject({ title: "2026 trial balance", internalNotes: "Draft – do not share" });
    expect(d.activity.length).toBeGreaterThan(0);
    expect((await listDocuments(h.db, manager, { q: "trial balance" })).map((x) => x.id)).toContain(doc.id);
    expect((await listDocuments(h.db, manager, { category: "bank_statements" })).map((x) => x.id)).not.toContain(doc.id);
  });

  it("rejects disallowed files", async () => {
    await expect(uploadDocument(h.db, manager, { clientId: clientA, fileName: "evil.exe", data: Buffer.from("MZ") }, deps)).rejects.toBeInstanceOf(ValidationError);
    await expect(uploadDocument(h.db, manager, { clientId: clientA, fileName: "fake.pdf", data: Buffer.from("not a pdf") }, deps)).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("private access", () => {
  let internalId: string, sharedId: string;
  beforeAll(async () => {
    internalId = (await uploadDocument(h.db, manager, { clientId: clientA, fileName: "internal.pdf", data: PDF }, deps)).id;
    sharedId = (await uploadDocument(h.db, manager, { clientId: clientA, fileName: "letter.pdf", data: PDF, visibility: "shared_with_client" }, deps)).id;
  });

  it("internal-only documents and internal notes never reach the portal", async () => {
    const mine = await listPortalDocuments(h.db, portalA, clientA);
    expect(mine.map((d) => d.id)).toContain(sharedId);
    expect(mine.map((d) => d.id)).not.toContain(internalId);
    expect(JSON.stringify(mine)).not.toContain("internalNotes");
    await expect(prepareDownload(h.db, portalA, internalId, { portalClientId: clientA }, deps)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("another client's portal user can't see or download, even by naming the client id", async () => {
    await expect(listPortalDocuments(h.db, portalB, clientA)).rejects.toBeInstanceOf(NotFoundError);
    await expect(prepareDownload(h.db, portalB, sharedId, { portalClientId: clientB }, deps)).rejects.toBeInstanceOf(NotFoundError);
    await expect(prepareDownload(h.db, portalB, sharedId, { portalClientId: clientA }, deps)).rejects.toBeInstanceOf(NotFoundError);
    await expect(prepareDownload(h.db, portalB, sharedId, {}, deps)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("downloads use short-lived signed URLs; read-only staff can't open file contents", async () => {
    const d = await prepareDownload(h.db, portalA, sharedId, { portalClientId: clientA }, deps);
    expect(d.kind).toBe("redirect");
    if (d.kind === "redirect") expect(d.url).toContain("token=short-lived");
    await expect(prepareDownload(h.db, readOnly, sharedId, {}, deps)).rejects.toBeInstanceOf(ForbiddenError);
    const preview = await prepareDownload(h.db, manager, sharedId, { inline: true }, deps);
    expect(preview).toMatchObject({ kind: "bytes", inline: true });
  });

  it("sharing notifies the client once; archived documents disappear from the portal", async () => {
    const id = (await uploadDocument(h.db, manager, { clientId: clientA, fileName: "later.pdf", data: PDF }, deps)).id;
    await setDocumentVisibility(h.db, manager, id, "shared_with_client");
    await setDocumentVisibility(h.db, manager, id, "internal_only");
    await setDocumentVisibility(h.db, manager, id, "shared_with_client");
    const notes = await h.db.select().from(clientNotifications).where(and(eq(clientNotifications.userId, portalA.userId), eq(clientNotifications.dedupeKey, `docshare:${id}`)));
    expect(notes).toHaveLength(1);
    await expect(archiveDocument(h.db, employee, id)).rejects.toBeInstanceOf(ForbiddenError);
    await archiveDocument(h.db, manager, id);
    expect((await listPortalDocuments(h.db, portalA, clientA)).map((d) => d.id)).not.toContain(id);
  });
});

describe("document requests", () => {
  let requestId: string;

  it("creates a request with four items; a double submit doesn't create a second request", async () => {
    const input = {
      clientId: clientA,
      title: "2026 Annual Tax Preparation Documents",
      dueDate: "2027-03-01",
      items: [
        { title: "Bank statements", category: "bank_statements", required: true },
        { title: "Income statements", category: "income_statements", required: true },
        { title: "Expense receipts", category: "expense_receipts", required: true },
        { title: "Previous tax return", category: "tax_returns", required: false },
      ],
    };
    const first = await createDocumentRequest(h.db, manager, input);
    const second = await createDocumentRequest(h.db, manager, input);
    expect(first.created).toBe(true);
    expect(second).toEqual({ id: first.id, created: false });
    requestId = first.id;
    expect((await h.db.select().from(documentRequests).where(eq(documentRequests.clientId, clientA))).length).toBe(1);
    await expect(createDocumentRequest(h.db, readOnly, { ...input, title: "x" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("drafts are invisible to the client; sending notifies once", async () => {
    expect(await listPortalDocumentRequests(h.db, portalA, clientA, "2027-01-01")).toHaveLength(0);
    await sendDocumentRequest(h.db, manager, requestId);
    await sendDocumentRequest(h.db, manager, requestId);
    const open = await listPortalDocumentRequests(h.db, portalA, clientA, "2027-01-01");
    expect(open).toHaveLength(1);
    expect(open[0]!.items).toHaveLength(4);
    expect(await listPortalDocumentRequests(h.db, portalB, clientB, "2027-01-01")).toHaveLength(0);
    const notes = await h.db.select().from(clientNotifications).where(eq(clientNotifications.dedupeKey, `docreq:${requestId}`));
    expect(notes).toHaveLength(1);
  });

  it("a portal upload fulfils its item (under review, never verified) and the request becomes partially fulfilled", async () => {
    const [bank] = (await getDocumentRequest(h.db, manager, requestId)).items;
    const doc = await uploadDocument(h.db, portalA, { clientId: clientA, requestItemId: bank!.id, fileName: "bank-jan.pdf", data: PDF }, deps);
    expect(doc).toMatchObject({ status: "under_review", visibility: "client_visible", documentRequestItemId: bank!.id, category: "bank_statements", uploadedByClient: true });
    const req = await getDocumentRequest(h.db, manager, requestId);
    expect(req.status).toBe("partially_fulfilled");
    expect(req.items[0]).toMatchObject({ status: "under_review" });
    expect(req.items[0]!.document?.id).toBe(doc.id);
    // Another client can't upload against this item.
    await expect(uploadDocument(h.db, portalB, { clientId: clientB, requestItemId: bank!.id, fileName: "x.pdf", data: PDF }, deps)).rejects.toBeInstanceOf(NotFoundError);
    await expect(uploadDocument(h.db, portalB, { clientId: clientA, requestItemId: bank!.id, fileName: "x.pdf", data: PDF }, deps)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("reject → replacement keeps history (v1 kept, v2 current); verify records the reviewer; all required verified → fulfilled", async () => {
    const before = await getDocumentRequest(h.db, manager, requestId);
    const v1 = before.items[0]!.document!.id;
    await expect(reviewDocument(h.db, employee, v1, "reject", "Pages missing")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(reviewDocument(h.db, manager, v1, "reject")).rejects.toBeInstanceOf(ValidationError);
    await reviewDocument(h.db, manager, v1, "reject", "Pages 2–3 are missing");
    let req = await getDocumentRequest(h.db, manager, requestId);
    expect(req.items[0]).toMatchObject({ status: "rejected" });
    const portalView = (await listPortalDocumentRequests(h.db, portalA, clientA, "2027-01-01"))[0]!.items[0]!;
    expect(portalView.document?.reviewNote).toBe("Pages 2–3 are missing");

    // The client re-uploads against the same item → a new version.
    const v2 = await uploadDocument(h.db, portalA, { clientId: clientA, requestItemId: before.items[0]!.id, fileName: "bank-jan-full.pdf", data: PDF2 }, deps);
    expect(v2).toMatchObject({ versionNumber: 2, rootDocumentId: v1, previousVersionId: v1, isCurrentVersion: true, status: "under_review" });
    const detail = await getDocumentDetail(h.db, manager, v2.id);
    expect(detail.versions.map((v) => [v.versionNumber, v.isCurrentVersion, v.status])).toEqual([
      [2, true, "under_review"],
      [1, false, "rejected"],
    ]);
    // v1 is untouched and its bytes are still stored.
    expect(bucket.files.size).toBeGreaterThan(0);
    await expect(uploadNewVersion(h.db, portalA, v1, { fileName: "x.pdf", data: PDF }, deps, clientA)).rejects.toBeInstanceOf(ValidationError);

    await expect(reviewDocument(h.db, employee, v2.id, "verify")).rejects.toBeInstanceOf(ForbiddenError);
    await reviewDocument(h.db, manager, v2.id, "verify");
    const verified = (await getDocumentDetail(h.db, manager, v2.id)).doc;
    expect(verified).toMatchObject({ status: "verified", reviewedById: manager.userId });
    expect(verified.reviewedAt).not.toBeNull();

    // Fulfil the other two required items; the optional one stays pending.
    req = await getDocumentRequest(h.db, manager, requestId);
    for (const item of req.items.slice(1, 3)) {
      const d = await uploadDocument(h.db, portalA, { clientId: clientA, requestItemId: item.id, fileName: `${item.title}.pdf`, data: PDF }, deps);
      await reviewDocument(h.db, manager, d.id, "verify");
    }
    req = await getDocumentRequest(h.db, manager, requestId);
    expect(req.status).toBe("fulfilled");
    expect(req.items[3]!.status).toBe("pending");
  });

  it("waiving an item counts as satisfied; overdue is computed from the due date", async () => {
    const r = await createDocumentRequest(h.db, manager, { clientId: clientA, title: "Payroll", dueDate: "2027-01-01", send: true, items: [{ title: "Payroll register", category: "payroll_documents" }] });
    expect((await getDocumentRequest(h.db, manager, r.id, "2027-02-01")).status).toBe("overdue");
    const item = (await getDocumentRequest(h.db, manager, r.id)).items[0]!;
    await expect(waiveRequestItem(h.db, employee, item.id)).rejects.toBeInstanceOf(ForbiddenError);
    await waiveRequestItem(h.db, manager, item.id);
    expect((await getDocumentRequest(h.db, manager, r.id, "2027-02-01")).status).toBe("fulfilled");
  });
});
