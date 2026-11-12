import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DbHandle } from "@/db";
import { auditEvents, leads } from "@/db/schema";
import type { Actor } from "@/lib/auth/actor";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { safeFileName } from "@/lib/file-rules";
import { zonedLocalToUtc } from "@/lib/time";
import { cancelAppointment, createAppointment, getCalendar, listPortalAppointments } from "@/services/calendar";
import { createEngagement, createTask } from "@/services/engagements";
import { archiveDocument, getDocumentForDownload, listClientDocuments, listPortalDocuments, setDocumentShared, uploadDocument } from "@/services/documents";
import { convertLead, countLeadsByStatus, createLead, listLeads, SpamRejectedError, submitWebsiteInquiry, updateLead } from "@/services/leads";
import { countUnreadForClient, countUnreadForStaff, getThread, listConversations, sendMessage } from "@/services/messages";
import { createClientWithPortalUser, createTestDb, createUser } from "./helpers";

const PDF = Buffer.from("%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

let h: DbHandle;
let admin: Actor, prepA: Actor, prepB: Actor, portalA: Actor, portalB: Actor;
let clientA: string, clientB: string, engA: string;

beforeAll(async () => {
  h = await createTestDb();
  admin = await createUser(h.db, { role: "admin", name: "Ada Admin" });
  prepA = await createUser(h.db, { role: "preparer", name: "Pat A" });
  prepB = await createUser(h.db, { role: "preparer", name: "Pat B" });
  const a = await createClientWithPortalUser(h.db, admin, "Client A");
  const b = await createClientWithPortalUser(h.db, admin, "Client B");
  clientA = a.client.id;
  clientB = b.client.id;
  portalA = a.portalUser;
  portalB = b.portalUser;
  engA = (await createEngagement(h.db, admin, clientA, { title: "A 1040", serviceType: "individual_tax", ownerId: prepA.userId, dueDate: "2027-03-10" })).id;
  await createEngagement(h.db, admin, clientB, { title: "B 1040", serviceType: "individual_tax", ownerId: prepB.userId, dueDate: "2027-03-12" });
  await createTask(h.db, admin, engA, { title: "A task", assigneeId: prepA.userId, dueDate: "2027-03-05" });
});
afterAll(async () => {
  await h.close();
});

describe("leads", () => {
  const form = (over: Record<string, unknown> = {}) => ({
    name: "Prospect Person",
    email: "Prospect@Example.test",
    message: "Need help with my 2026 return",
    consent: "on",
    website: "",
    startedAt: String(Date.now() - 10_000),
    ...over,
  });

  it("creates a lead from the website form with consent recorded", async () => {
    const { id } = await submitWebsiteInquiry(h.db, form());
    const [lead] = await h.db.select().from(leads).where(eq(leads.id, id));
    expect(lead).toMatchObject({ source: "website", status: "new", email: "prospect@example.test" });
    expect(lead!.consentAt).toBeInstanceOf(Date);
  });

  it("rejects bots: honeypot, too-fast submissions, and floods", async () => {
    await expect(submitWebsiteInquiry(h.db, form({ website: "http://spam" }))).rejects.toBeInstanceOf(SpamRejectedError);
    await expect(submitWebsiteInquiry(h.db, form({ startedAt: String(Date.now()) }))).rejects.toBeInstanceOf(SpamRejectedError);
    await expect(submitWebsiteInquiry(h.db, form({ startedAt: "nope" }))).rejects.toBeInstanceOf(SpamRejectedError);
    const email = "flood@example.test";
    for (let i = 0; i < 3; i++) await submitWebsiteInquiry(h.db, form({ email }));
    await expect(submitWebsiteInquiry(h.db, form({ email }))).rejects.toBeInstanceOf(SpamRejectedError);
  });

  it("requires consent and a valid email", async () => {
    const err = await submitWebsiteInquiry(h.db, form({ consent: undefined, email: "bad" })).catch((e) => e);
    expect(Object.keys((err as ValidationError).fieldErrors).sort()).toEqual(["consent", "email"]);
  });

  it("lets staff work the pipeline and convert a lead into a client", async () => {
    const lead = await createLead(h.db, prepA, { name: "Riley Prospect", email: "riley@example.test", company: "Riley Co", source: "referral" });
    const updated = await updateLead(h.db, prepA, lead.id, { name: "Riley Prospect", email: "riley@example.test", company: "Riley Co", source: "referral", status: "qualified", followUpDate: "2027-01-05", notes: "Wants S-corp advice" });
    expect(updated.status).toBe("qualified");
    const { clientId } = await convertLead(h.db, prepA, lead.id);
    expect((await convertLead(h.db, prepA, lead.id)).clientId).toBe(clientId); // idempotent
    expect((await listLeads(h.db, prepA, { status: "converted" })).some((l) => l.convertedClientId === clientId)).toBe(true);
    await expect(updateLead(h.db, prepA, lead.id, { name: "x", source: "other", status: "new" })).rejects.toBeInstanceOf(ValidationError);
    expect((await countLeadsByStatus(h.db, admin)).converted).toBeGreaterThanOrEqual(1);
  });

  it("is closed to portal users", async () => {
    await expect(listLeads(h.db, portalA)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createLead(h.db, portalA, { name: "x" })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("documents", () => {
  it("lets staff upload; the client sees it only when shared", async () => {
    const doc = await uploadDocument(h.db, prepA, { clientId: clientA, engagementId: engA, fileName: "C:\\fakepath\\2026 W-2.pdf", data: PDF });
    expect(doc).toMatchObject({ fileName: "2026 W-2.pdf", contentType: "application/pdf", visibleToClient: false, scanStatus: "not_scanned" });
    expect(await listPortalDocuments(h.db, portalA)).toHaveLength(0);
    await expect(getDocumentForDownload(h.db, portalA, doc.id)).rejects.toBeInstanceOf(NotFoundError);
    await setDocumentShared(h.db, prepA, doc.id, true);
    expect((await listPortalDocuments(h.db, portalA)).map((d) => d.id)).toContain(doc.id);
    const { data } = await getDocumentForDownload(h.db, portalA, doc.id);
    expect(data.equals(PDF)).toBe(true);
  });

  it("lets clients upload only to their own record, always visible to them", async () => {
    const doc = await uploadDocument(h.db, portalA, { clientId: clientA, fileName: "receipt.png", data: PNG });
    expect(doc.visibleToClient).toBe(true);
    expect(doc.uploadedByClient).toBe(true);
    await expect(uploadDocument(h.db, portalA, { clientId: clientB, fileName: "x.pdf", data: PDF })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(uploadDocument(h.db, portalA, { clientId: clientA, engagementId: (await listClientDocuments(h.db, admin, clientB))[0]?.engagementId ?? "00000000-0000-4000-8000-000000000000", fileName: "x.pdf", data: PDF })).rejects.toBeInstanceOf(ValidationError);
    await expect(setDocumentShared(h.db, prepA, doc.id, false)).rejects.toBeInstanceOf(ValidationError);
  });

  it("isolates documents between clients and unassigned staff", async () => {
    const docB = await uploadDocument(h.db, admin, { clientId: clientB, fileName: "b.pdf", data: PDF, visibleToClient: true });
    await expect(getDocumentForDownload(h.db, portalA, docB.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getDocumentForDownload(h.db, prepA, docB.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(listClientDocuments(h.db, prepA, clientB)).rejects.toBeInstanceOf(NotFoundError);
    await expect(uploadDocument(h.db, prepA, { clientId: clientB, fileName: "x.pdf", data: PDF })).rejects.toBeInstanceOf(NotFoundError);
    expect((await listPortalDocuments(h.db, portalB)).map((d) => d.id)).toEqual([docB.id]);
  });

  it("rejects disguised, oversized, empty and disallowed files", async () => {
    const up = (fileName: string, data: Buffer) => uploadDocument(h.db, admin, { clientId: clientA, fileName, data });
    await expect(up("invoice.pdf", Buffer.from("MZ\x90\x00 not a pdf"))).rejects.toBeInstanceOf(ValidationError);
    await expect(up("payload.exe", Buffer.from("MZ"))).rejects.toBeInstanceOf(ValidationError);
    await expect(up("page.html", Buffer.from("<script>"))).rejects.toBeInstanceOf(ValidationError);
    await expect(up("empty.pdf", Buffer.alloc(0))).rejects.toBeInstanceOf(ValidationError);
    await expect(up("big.pdf", Buffer.concat([PDF, Buffer.alloc(25 * 1024 * 1024)]))).rejects.toBeInstanceOf(ValidationError);
    expect(safeFileName('../../etc/"pass<wd>".txt')).toBe("passwd.txt");
  });

  it("blocks files a scanner flags, and archived files disappear", async () => {
    const infected = { scan: async () => "infected" as const };
    await expect(uploadDocument(h.db, admin, { clientId: clientA, fileName: "x.pdf", data: PDF }, { scanner: infected })).rejects.toBeInstanceOf(ValidationError);
    const doc = await uploadDocument(h.db, admin, { clientId: clientA, fileName: "old.pdf", data: PDF, visibleToClient: true });
    await archiveDocument(h.db, admin, doc.id);
    await expect(getDocumentForDownload(h.db, portalA, doc.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(archiveDocument(h.db, portalA, doc.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("audits downloads without file contents", async () => {
    const events = await h.db.select().from(auditEvents).where(eq(auditEvents.action, "document.download"));
    expect(events.length).toBeGreaterThan(0);
    expect(JSON.stringify(events)).not.toContain("%PDF");
  });
});

describe("messages", () => {
  it("delivers between a client and staff, with unread counts and read receipts", async () => {
    await sendMessage(h.db, portalA, "  Hi, I uploaded my W-2.  ");
    expect(await countUnreadForStaff(h.db, prepA)).toBe(1);
    expect(await countUnreadForStaff(h.db, prepB)).toBe(0); // not assigned to client A
    const inbox = await listConversations(h.db, prepA);
    expect(inbox[0]).toMatchObject({ clientName: "Client A", unread: 1, lastFromClient: true });
    const thread = await getThread(h.db, prepA, clientA);
    expect(thread[0]!.body).toBe("Hi, I uploaded my W-2.");
    expect(await countUnreadForStaff(h.db, prepA)).toBe(0);

    await sendMessage(h.db, prepA, "Thanks, received.", clientA);
    expect(await countUnreadForClient(h.db, portalA)).toBe(1);
    const own = await getThread(h.db, portalA);
    expect(own.map((m) => m.mine)).toEqual([true, false]);
    expect(await countUnreadForClient(h.db, portalA)).toBe(0);
  });

  it("keeps conversations private", async () => {
    // A client's thread is always their own, whatever id they pass.
    const bThread = await getThread(h.db, portalB, clientA);
    expect(bThread.some((m) => m.body.includes("W-2"))).toBe(false);
    await expect(getThread(h.db, prepB, clientA)).rejects.toBeInstanceOf(NotFoundError);
    await expect(sendMessage(h.db, prepB, "hi", clientA)).rejects.toBeInstanceOf(NotFoundError);
    await expect(listConversations(h.db, portalA)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(sendMessage(h.db, portalA, "   ")).rejects.toBeInstanceOf(ValidationError);
    const audit = await h.db.select().from(auditEvents).where(eq(auditEvents.action, "message.send"));
    expect(JSON.stringify(audit)).not.toContain("Thanks, received.");
  });
});

describe("calendar", () => {
  it("converts firm-local times to UTC across daylight saving", () => {
    expect(zonedLocalToUtc("2027-03-01T09:00", "America/New_York").toISOString()).toBe("2027-03-01T14:00:00.000Z");
    expect(zonedLocalToUtc("2027-07-01T09:00", "America/New_York").toISOString()).toBe("2027-07-01T13:00:00.000Z");
  });

  it("combines appointments and due dates, scoped to what each person can see", async () => {
    const appt = await createAppointment(h.db, prepA, { title: "Review meeting", clientId: clientA, ownerId: prepA.userId, kind: "video", startsAt: "2027-03-03T10:00", durationMinutes: "45" });
    await createAppointment(h.db, admin, { title: "B intake", clientId: clientB, ownerId: prepB.userId, kind: "in_person", startsAt: "2027-03-04T10:00", durationMinutes: 30 });
    await createAppointment(h.db, admin, { title: "Staff meeting", ownerId: admin.userId, kind: "video", startsAt: "2027-03-02T08:00", durationMinutes: 60 });
    expect(appt.endsAt.getTime() - appt.startsAt.getTime()).toBe(45 * 60_000);

    const itemsA = await getCalendar(h.db, prepA, "2027-03-01", "2027-04-01");
    const titles = itemsA.map((i) => i.title);
    expect(titles).toEqual(expect.arrayContaining(["Staff meeting", "Review meeting", "A task", "A 1040"]));
    expect(titles).not.toContain("B intake");
    expect(titles).not.toContain("B 1040");
    expect(itemsA.find((i) => i.title === "Staff meeting")).toMatchObject({ type: "internal" });

    await expect(createAppointment(h.db, prepA, { title: "x", clientId: clientB, ownerId: prepA.userId, kind: "phone", startsAt: "2027-03-03T10:00", durationMinutes: 30 })).rejects.toBeInstanceOf(NotFoundError);
    await expect(getCalendar(h.db, portalA, "2027-03-01", "2027-04-01")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("shows clients their own upcoming appointments only, and honours cancellation", async () => {
    const now = new Date("2027-02-01T00:00:00Z");
    const mine = await listPortalAppointments(h.db, portalA, now);
    expect(mine.map((a) => a.title)).toEqual(["Review meeting"]);
    await cancelAppointment(h.db, prepA, mine[0]!.id);
    expect(await listPortalAppointments(h.db, portalA, now)).toEqual([]);
    expect((await listPortalAppointments(h.db, portalB, now)).map((a) => a.title)).toEqual(["B intake"]);
  });
});
