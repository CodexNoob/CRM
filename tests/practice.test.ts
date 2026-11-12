import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "@/db";
import type { Actor } from "@/lib/auth/actor";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { site } from "@/content/site";
import { createClient } from "@/services/clients";
import { createEngagement } from "@/services/engagements";
import { createLead, convertLead } from "@/services/leads";
import { getPracticeReport, listPortalAccounts, listTaxYears, listWork, TAX_SERVICES, BOOKKEEPING_SERVICES } from "@/services/practice";
import { createAnnouncement, getWebsiteContent, saveFirmProfile, setAnnouncementPublished } from "@/services/settings";
import { createClientWithPortalUser, createTestDb, createUser } from "./helpers";

let h: DbHandle;
let admin: Actor, prepA: Actor, portal: Actor;

beforeAll(async () => {
  h = await createTestDb();
  admin = await createUser(h.db, { role: "admin" });
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
    await convertLead(h.db, admin, lead.id);
    const r = await getPracticeReport(h.db, admin);
    expect(r.byService.find((s) => s.serviceType === "business_tax")).toMatchObject({ open: 0, done: 1 });
    expect(r.leads.find((l) => l.status === "converted")?.count).toBe(1);
    expect(r.last30.newClients).toBeGreaterThanOrEqual(3);
    expect(r.last30.engagementsCompleted).toBe(1);
  });
});

describe("settings drive the website", () => {
  it("uses defaults until an admin saves a profile, then the database", async () => {
    const before = await getWebsiteContent(h.db, admin.firmId);
    expect(before.profile).toMatchObject({ name: site.name, fromDatabase: false });

    await saveFirmProfile(h.db, admin, {
      name: "Rivera & Co. CPAs",
      phone: "(555) 010-2222",
      email: "office@example.test",
      addressLine1: "1 Main St",
      hours: "Mon – Fri | 9–5\nSat | By appointment",
    });
    const after = await getWebsiteContent(h.db, admin.firmId);
    expect(after.profile).toMatchObject({ name: "Rivera & Co. CPAs", phone: "(555) 010-2222", addressLines: ["1 Main St"], fromDatabase: true });
    expect(after.profile.hours).toEqual([["Mon – Fri", "9–5"], ["Sat", "By appointment"]]);

    // Saving again updates the single profile row.
    await saveFirmProfile(h.db, admin, { name: "Rivera CPAs" });
    expect((await getWebsiteContent(h.db, admin.firmId)).profile.name).toBe("Rivera CPAs");
  });

  it("replaces default announcements once the firm manages its own", async () => {
    expect((await getWebsiteContent(h.db, admin.firmId)).announcements[0]!.id).toMatch(/^default-/);
    const a = await createAnnouncement(h.db, admin, { title: "Office closed Friday", body: "We reopen Monday.", publishedOn: "2026-11-20" });
    expect((await getWebsiteContent(h.db, admin.firmId)).announcements.map((x) => x.title)).toEqual(["Office closed Friday"]);
    await setAnnouncementPublished(h.db, admin, a.id, false);
    expect((await getWebsiteContent(h.db, admin.firmId)).announcements).toEqual([]);
  });

  it("is admin-only and validated", async () => {
    await expect(saveFirmProfile(h.db, prepA, { name: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createAnnouncement(h.db, portal, { title: "x", body: "y", publishedOn: "2026-01-01" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(saveFirmProfile(h.db, admin, { name: "", email: "nope" })).rejects.toBeInstanceOf(ValidationError);
  });
});
