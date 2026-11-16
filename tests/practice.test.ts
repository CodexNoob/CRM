import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "@/db";
import type { Actor } from "@/lib/auth/actor";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { createClient } from "@/services/clients";
import { createEngagement } from "@/services/engagements";
import { createLead, convertLead, listLeads } from "@/services/leads";
import { getPracticeReport, listPortalAccounts, listTaxYears, listWork, TAX_SERVICES, BOOKKEEPING_SERVICES } from "@/services/practice";
import {
  createAnnouncement,
  createPlatformInquiry,
  getOrganizationProfile,
  getPlatformProfile,
  getPortalAnnouncements,
  listPlatformInquiries,
  saveFirmProfile,
  savePlatformProfile,
  setAnnouncementPublished,
} from "@/services/settings";
import { createClientWithPortalUser, createTestDb, createUser } from "./helpers";

let h: DbHandle;
let admin: Actor, prepA: Actor, portal: Actor, superAdmin: Actor;

beforeAll(async () => {
  h = await createTestDb();
  admin = await createUser(h.db, { role: "admin" });
  superAdmin = await createUser(h.db, { role: "super_admin" });
  prepA = await createUser(h.db, { role: "employee" });
  const a = await createClientWithPortalUser(h.db, admin, "Alpha");
  portal = a.portalUser;
  const b = await createClient(h.db, admin, { type: "business", displayName: "Beta LLC" });
  await createEngagement(h.db, admin, a.client.id, { title: "2026 1040", serviceType: "individual_tax", taxYear: 2026, status: "in_review", ownerId: prepA.userId });
  await createEngagement(h.db, admin, b.id, { title: "2025 1120-S", serviceType: "business_tax", taxYear: 2025, status: "filed", ownerId: admin.userId });
  await createEngagement(h.db, admin, b.id, { title: "Monthly books", serviceType: "bookkeeping", status: "in_progress", ownerId: admin.userId });
});
afterAll(async () => {
  await h.close();
});

describe("tax & accounting views", () => {
  it("split engagements by service and year, scoped by access", async () => {
    expect((await listWork(h.db, admin, { services: TAX_SERVICES })).map((w) => w.title).sort()).toEqual(["2025 1120-S", "2026 1040"]);
    expect((await listWork(h.db, admin, { services: TAX_SERVICES, taxYear: 2026 })).map((w) => w.title)).toEqual(["2026 1040"]);
    expect((await listWork(h.db, admin, { services: BOOKKEEPING_SERVICES })).map((w) => w.title)).toEqual(["Monthly books"]);
    expect(await listTaxYears(h.db, admin)).toEqual([2026, 2025]);
    // The preparer owns only Alpha's return.
    expect((await listWork(h.db, prepA, { services: TAX_SERVICES })).map((w) => w.title)).toEqual(["2026 1040"]);
    await expect(listWork(h.db, portal, { services: TAX_SERVICES })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("lists portal accounts with status", async () => {
    const rows = await listPortalAccounts(h.db, admin);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ clientName: "Alpha", hasPassword: false, lastSignIn: null, unreadFromClient: 0 });
    await expect(listPortalAccounts(h.db, portal)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("builds practice reports from live data", async () => {
    const lead = await createLead(h.db, admin, { name: "Prospect", source: "referral" });
    await convertLead(h.db, admin, lead.id, { mode: "new", type: "individual", displayName: "Prospect" });
    const r = await getPracticeReport(h.db, admin);
    expect(r.byService.find((s) => s.serviceType === "business_tax")).toMatchObject({ open: 0, done: 1 });
    expect(r.leads.find((l) => l.status === "converted")?.count).toBe(1);
    expect(r.last30.newClients).toBeGreaterThanOrEqual(3);
    expect(r.last30.engagementsCompleted).toBe(1);
  });
});

describe("platform and organization settings are separate", () => {
  it("uses defaults until an admin saves a profile, then the database", async () => {
    const before = await getOrganizationProfile(h.db, admin.firmId);
    expect(before).toMatchObject({ name: "Test Firm", fromDatabase: false, websiteUrl: "", socialLinks: [] });

    await saveFirmProfile(h.db, admin, {
      name: "Rivera & Co. CPAs",
      phone: "(555) 010-2222",
      email: "office@example.test",
      addressLine1: "1 Main St",
      websiteUrl: "https://rivera.example.test",
      socialLinks: "LinkedIn | https://linkedin.example.test/rivera",
      timeZone: "America/Chicago",
      locale: "en-US",
      currency: "USD",
      hours: "Mon – Fri | 9–5\nSat | By appointment",
    });
    const after = await getOrganizationProfile(h.db, admin.firmId);
    expect(after).toMatchObject({
      name: "Rivera & Co. CPAs",
      phone: "(555) 010-2222",
      addressLines: ["1 Main St"],
      websiteUrl: "https://rivera.example.test",
      timeZone: "America/Chicago",
      fromDatabase: true,
    });
    expect(after.hours).toEqual([["Mon – Fri", "9–5"], ["Sat", "By appointment"]]);
    expect(after.socialLinks).toEqual([{ label: "LinkedIn", url: "https://linkedin.example.test/rivera" }]);

    // Saving again updates the single profile row.
    await saveFirmProfile(h.db, admin, { name: "Rivera CPAs" });
    expect((await getOrganizationProfile(h.db, admin.firmId)).name).toBe("Rivera CPAs");
    expect((await getPlatformProfile(h.db)).name).not.toBe("Rivera CPAs");
  });

  it("shows firm announcements only to authenticated clients in that firm", async () => {
    expect(await getPortalAnnouncements(h.db, portal)).toEqual([]);
    const a = await createAnnouncement(h.db, admin, { title: "Office closed Friday", body: "We reopen Monday.", publishedOn: "2026-11-20" });
    expect((await getPortalAnnouncements(h.db, portal)).map((x) => x.title)).toEqual(["Office closed Friday"]);
    await setAnnouncementPublished(h.db, admin, a.id, false);
    expect(await getPortalAnnouncements(h.db, portal)).toEqual([]);
    await expect(getPortalAnnouncements(h.db, admin)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("keeps platform settings and inquiries Super-Admin-only", async () => {
    await expect(saveFirmProfile(h.db, prepA, { name: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createAnnouncement(h.db, portal, { title: "x", body: "y", publishedOn: "2026-01-01" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(saveFirmProfile(h.db, admin, { name: "", email: "nope" })).rejects.toBeInstanceOf(ValidationError);
    await expect(savePlatformProfile(h.db, admin, { name: "Tenant Admin" })).rejects.toBeInstanceOf(ForbiddenError);

    await savePlatformProfile(h.db, superAdmin, { name: "TaxDesk Platform", officialEmail: "support@taxdesk.example.test" });
    const inquiry = await createPlatformInquiry(h.db, {
      name: "Platform Contact Only",
      email: "platform-contact@example.test",
      topic: "sales",
      message: "Please send pricing.",
    });
    expect((await getPlatformProfile(h.db)).name).toBe("TaxDesk Platform");
    expect((await listPlatformInquiries(h.db, superAdmin)).map((row) => row.id)).toContain(inquiry.id);
    expect(JSON.stringify(await listLeads(h.db, admin))).not.toContain("platform-contact@example.test");
    await expect(listPlatformInquiries(h.db, admin)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
