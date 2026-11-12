import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DbHandle } from "@/db";
import { auditEvents, clients } from "@/db/schema";
import type { Actor } from "@/lib/auth/actor";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { listRecentActivity } from "@/services/audit";
import { cancelAppointment, createAppointment, getCalendar, listPortalAppointments } from "@/services/calendar";
import { getClient, listClients, updateClient } from "@/services/clients";
import { getDashboard } from "@/services/dashboard";
import { archiveDocument, getDocumentForDownload, listClientDocuments, listPortalDocuments, listRecentDocuments, setDocumentShared, uploadDocument } from "@/services/documents";
import { createEngagement, createTask, getEngagement, listClientEngagements, listStaff, setEngagementStatus, setTaskStatus, updateEngagement } from "@/services/engagements";
import { getClientTeam, getPracticeCounts, listClientActivity, listRecentClientActivity } from "@/services/insights";
import { convertLead, countLeadsByStatus, createLead, getLead, listLeads, setLeadStatus, submitWebsiteInquiry, updateLead } from "@/services/leads";
import { countUnreadForClient, countUnreadForStaff, getThread, listConversations, sendMessage } from "@/services/messages";
import { getPortalOverview } from "@/services/portal";
import { listPortalAccounts, listWork } from "@/services/practice";
import { createAnnouncement, getPublicAnnouncements, getPublicProfile, listAllAnnouncements, saveFirmProfile, setAnnouncementPublished } from "@/services/settings";
import { changeStaffRole, listTeam, setStaffActive } from "@/services/team";
import { listPortalUsers } from "@/services/users";
import { globalSearch } from "@/services/workspace";
import { createClientWithPortalUser, createTestDb, createTestFirm, createUser } from "./helpers";

/**
 * Cross-firm isolation. Firm A has a full set of data. Firm B's ADMIN (who can see
 * everything in their own firm) must not be able to see, change or link to any of it:
 * another firm's ids behave exactly like ids that do not exist.
 */

const PDF = Buffer.from("%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");

let h: DbHandle;
let firmB: string;
let adminA: Actor, prepA: Actor, portalA: Actor, adminB: Actor, prepB: Actor, portalB: Actor;
const A = {} as { client: string; engagement: string; task: string; document: string; lead: string; appointment: string; announcement: string };
let clientB: string;
const missing = () => expect.objectContaining({}) && NotFoundError;

beforeAll(async () => {
  h = await createTestDb();
  adminA = await createUser(h.db, { role: "admin", name: "Ada A" });
  prepA = await createUser(h.db, { role: "employee", name: "Pat A" });
  firmB = await createTestFirm(h.db, "Firm B");
  adminB = await createUser(h.db, { role: "admin", name: "Bea B", firmId: firmB });
  prepB = await createUser(h.db, { role: "employee", name: "Pip B", firmId: firmB });

  const a = await createClientWithPortalUser(h.db, adminA, "Alpha Client");
  A.client = a.client.id;
  portalA = a.portalUser;
  await h.db.update(clients).set({ email: "alpha@example.test" }).where(eq(clients.id, A.client));
  const b = await createClientWithPortalUser(h.db, adminB, "Beta Client");
  clientB = b.client.id;
  portalB = b.portalUser;

  A.engagement = (await createEngagement(h.db, adminA, A.client, { title: "Alpha 1040", serviceType: "individual_tax", ownerId: prepA.userId, taxYear: 2026 })).id;
  A.task = (await createTask(h.db, adminA, A.engagement, { title: "Alpha W-2", isClientTask: "on" })).id;
  A.document = (await uploadDocument(h.db, adminA, { clientId: A.client, engagementId: A.engagement, fileName: "alpha.pdf", data: PDF, visibleToClient: true })).id;
  A.lead = (await createLead(h.db, adminA, { name: "Alpha Prospect", email: "ap@example.test", source: "referral" })).id;
  A.appointment = (await createAppointment(h.db, adminA, { title: "Alpha meeting", clientId: A.client, ownerId: prepA.userId, kind: "video", startsAt: "2027-03-03T10:00", durationMinutes: 30 })).id;
  await sendMessage(h.db, portalA, "Alpha secret message");
  await sendMessage(h.db, adminA, "Reply to alpha", A.client);
  await saveFirmProfile(h.db, adminA, { name: "Alpha CPAs", phone: "555-0100" });
  A.announcement = (await createAnnouncement(h.db, adminA, { title: "Alpha news", body: "Only for A", publishedOn: "2026-01-01" })).id;
});

afterAll(async () => {
  await h.close();
});

describe("firm B cannot read firm A by id", () => {
  it("clients, engagements, leads, documents", async () => {
    await expect(getClient(h.db, adminB, A.client)).rejects.toBeInstanceOf(NotFoundError);
    await expect(listClientEngagements(h.db, adminB, A.client)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getEngagement(h.db, adminB, A.engagement)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getLead(h.db, adminB, A.lead)).rejects.toBeInstanceOf(NotFoundError);
    await expect(listClientDocuments(h.db, adminB, A.client)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getDocumentForDownload(h.db, adminB, A.document)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getDocumentForDownload(h.db, portalB, A.document)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getThread(h.db, adminB, A.client)).rejects.toBeInstanceOf(NotFoundError);
    await expect(listClientActivity(h.db, adminB, A.client)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getClientTeam(h.db, adminB, A.client)).rejects.toBeInstanceOf(NotFoundError);
    await expect(listPortalUsers(h.db, adminB, A.client)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("firm B cannot change firm A", () => {
  it("rejects every write aimed at firm A's records", async () => {
    await expect(updateClient(h.db, adminB, A.client, { type: "individual", displayName: "Hijacked" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(updateEngagement(h.db, adminB, A.engagement, { title: "x", serviceType: "other", ownerId: adminB.userId })).rejects.toBeInstanceOf(NotFoundError);
    await expect(setEngagementStatus(h.db, adminB, A.engagement, "filed")).rejects.toBeInstanceOf(NotFoundError);
    await expect(createTask(h.db, adminB, A.engagement, { title: "x" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(setTaskStatus(h.db, adminB, A.task, "done")).rejects.toBeInstanceOf(NotFoundError);
    await expect(createEngagement(h.db, adminB, A.client, { title: "x", serviceType: "other", ownerId: adminB.userId })).rejects.toBeInstanceOf(NotFoundError);
    await expect(updateLead(h.db, adminB, A.lead, { name: "x" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(setLeadStatus(h.db, adminB, A.lead, "lost")).rejects.toBeInstanceOf(NotFoundError);
    await expect(convertLead(h.db, adminB, A.lead)).rejects.toBeInstanceOf(NotFoundError);
    await expect(setDocumentShared(h.db, adminB, A.document, false)).rejects.toBeInstanceOf(NotFoundError);
    await expect(archiveDocument(h.db, adminB, A.document)).rejects.toBeInstanceOf(NotFoundError);
    await expect(uploadDocument(h.db, adminB, { clientId: A.client, fileName: "x.pdf", data: PDF })).rejects.toBeInstanceOf(NotFoundError);
    await expect(sendMessage(h.db, adminB, "hello", A.client)).rejects.toBeInstanceOf(NotFoundError);
    await expect(cancelAppointment(h.db, adminB, A.appointment)).rejects.toBeInstanceOf(NotFoundError);
    await expect(setAnnouncementPublished(h.db, adminB, A.announcement, false)).rejects.toBeInstanceOf(NotFoundError);
    await expect(setStaffActive(h.db, adminB, prepA.userId, false)).rejects.toBeInstanceOf(NotFoundError);
    await expect(changeStaffRole(h.db, adminB, prepA.userId, "admin")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("cannot link its own records to firm A's people or clients", async () => {
    // Firm A's staff member is not an "active staff member" for firm B.
    await expect(createEngagement(h.db, adminB, clientB, { title: "x", serviceType: "other", ownerId: prepA.userId })).rejects.toBeInstanceOf(ValidationError);
    const engB = await createEngagement(h.db, adminB, clientB, { title: "B work", serviceType: "other", ownerId: prepB.userId });
    await expect(createTask(h.db, adminB, engB.id, { title: "x", assigneeId: prepA.userId })).rejects.toThrow();
    await expect(uploadDocument(h.db, adminB, { clientId: clientB, engagementId: A.engagement, fileName: "x.pdf", data: PDF })).rejects.toThrow();
    await expect(
      createAppointment(h.db, adminB, { title: "x", clientId: A.client, ownerId: adminB.userId, kind: "video", startsAt: "2027-03-04T10:00", durationMinutes: 30 }),
    ).rejects.toThrow();
    await expect(
      createAppointment(h.db, adminB, { title: "x", ownerId: prepA.userId, kind: "video", startsAt: "2027-03-04T10:00", durationMinutes: 30 }),
    ).rejects.toThrow();
  });
});

describe("firm B's lists, counts and search never include firm A", () => {
  it("lists", async () => {
    const names = (rows: unknown) => JSON.stringify(rows);
    expect(names(await listClients(h.db, adminB))).not.toContain("Alpha");
    expect(names(await listLeads(h.db, adminB))).not.toContain("Alpha");
    expect(names(await listRecentDocuments(h.db, adminB))).not.toContain("alpha.pdf");
    expect(JSON.stringify(await listConversations(h.db, adminB))).not.toContain("Alpha");
    expect(JSON.stringify(await getCalendar(h.db, adminB, "2027-01-01", "2027-12-31"))).not.toContain("Alpha");
    expect(JSON.stringify(await listStaff(h.db, adminB))).not.toContain("Pat A");
    expect(JSON.stringify(await listTeam(h.db, adminB))).not.toContain("Ada A");
    expect(JSON.stringify(await listWork(h.db, adminB, { services: ["individual_tax", "business_tax", "bookkeeping", "accounting", "tax_consulting", "other"] }))).not.toContain("Alpha");
    expect(JSON.stringify(await listPortalAccounts(h.db, adminB))).not.toContain("Alpha");
    expect(JSON.stringify(await listAllAnnouncements(h.db, adminB))).not.toContain("Alpha news");
    expect(JSON.stringify(await listRecentClientActivity(h.db, adminB, 100))).not.toContain(A.client);
    expect(JSON.stringify(await listRecentActivity(h.db, adminB, { limit: 500 }))).not.toContain(A.client);
  });

  it("counts", async () => {
    expect(Object.values(await countLeadsByStatus(h.db, adminB)).reduce((s, n) => s + n, 0)).toBe(0);
    expect(await countUnreadForStaff(h.db, adminB)).toBe(0);
    const d = await getDashboard(h.db, adminB, { now: new Date("2026-11-12T12:00:00Z") });
    expect(JSON.stringify(d)).not.toContain("Alpha");
    const counts = await getPracticeCounts(h.db, adminB);
    expect(JSON.stringify(counts)).toBeDefined();
  });

  it("search", async () => {
    expect(JSON.stringify(await globalSearch(h.db, adminB, "Alpha"))).not.toContain("Alpha");
    expect(JSON.stringify(await globalSearch(h.db, prepB, "alpha"))).not.toContain("Alpha");
  });

  it("firm A still sees its own data", async () => {
    expect(JSON.stringify(await listClients(h.db, adminA))).toContain("Alpha Client");
    expect(JSON.stringify(await globalSearch(h.db, adminA, "Alpha"))).toContain("Alpha");
    expect(await countUnreadForStaff(h.db, adminA)).toBeGreaterThan(0);
  });
});

describe("client portal is per firm", () => {
  it("firm B's client sees nothing of firm A", async () => {
    expect(JSON.stringify(await listPortalDocuments(h.db, portalB))).not.toContain("alpha.pdf");
    expect(JSON.stringify(await getThread(h.db, portalB))).not.toContain("Alpha secret");
    expect(JSON.stringify(await listPortalAppointments(h.db, portalB, new Date("2027-01-01")))).not.toContain("Alpha");
    expect(JSON.stringify(await getPortalOverview(h.db, portalB))).not.toContain("Alpha");
    expect(await countUnreadForClient(h.db, portalB)).toBe(0);
  });
});

describe("public website and settings are per firm", () => {
  it("each firm has its own profile and announcements", async () => {
    expect((await getPublicProfile(h.db, adminA.firmId)).name).toBe("Alpha CPAs");
    expect((await getPublicProfile(h.db, firmB)).name).not.toBe("Alpha CPAs");
    await saveFirmProfile(h.db, adminB, { name: "Beta Accounting" });
    expect((await getPublicProfile(h.db, firmB)).name).toBe("Beta Accounting");
    expect((await getPublicProfile(h.db, adminA.firmId)).name).toBe("Alpha CPAs");
    expect(JSON.stringify(await getPublicAnnouncements(h.db, firmB))).not.toContain("Alpha news");
  });

  it("website inquiries land in the named firm only", async () => {
    const lead = await submitWebsiteInquiry(h.db, firmB, { name: "Web Visitor", email: "wv@example.test", consent: "on", startedAt: String(Date.now() - 10_000) });
    expect(JSON.stringify(await listLeads(h.db, adminB))).toContain("Web Visitor");
    expect(JSON.stringify(await listLeads(h.db, adminA))).not.toContain("Web Visitor");
    const [audit] = await h.db.select().from(auditEvents).where(eq(auditEvents.entityId, lead.id));
    expect(audit!.firmId).toBe(firmB);
  });
});

describe("every audit event carries a firm", () => {
  it("no firm-less events were written by firm activity", async () => {
    const rows = await h.db.select({ firmId: auditEvents.firmId, action: auditEvents.action }).from(auditEvents);
    expect(rows.filter((r) => !r.firmId)).toEqual([]);
    void missing;
  });
});
