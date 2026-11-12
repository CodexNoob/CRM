import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { DbHandle } from "@/db";
import { clients, leads } from "@/db/schema";
import type { Actor } from "@/lib/auth/actor";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import {
  addOnboardingItem,
  deriveOnboardingStatus,
  getClient,
  listClientContacts,
  listOnboardingItems,
  saveClientContact,
  setClientArchived,
  setOnboardingItemStatus,
  updateClient,
  listClients,
} from "@/services/clients";
import {
  addLeadActivity,
  AlreadyConvertedError,
  convertLead,
  createLead,
  exportLeadsCsv,
  findLeadDuplicates,
  getLead,
  listLeads,
  setLeadStatus,
  updateLead,
} from "@/services/leads";
import { listClientTimeline, listEntityTimeline, listStatusHistory } from "@/services/timeline";
import { createTestDb, createUser } from "./helpers";

/**
 * Spec scenarios 1–3 (lead creation, lead conversion, client management), run against the
 * real services and a real (in-memory) Postgres. "Reload" = reading the record back from the DB.
 */

let h: DbHandle;
let admin: Actor, manager: Actor, employee: Actor, readOnly: Actor;

beforeAll(async () => {
  h = await createTestDb();
  admin = await createUser(h.db, { role: "admin", name: "Ada Admin" });
  manager = await createUser(h.db, { role: "manager", name: "Max Manager" });
  employee = await createUser(h.db, { role: "employee", name: "Eve Employee" });
  readOnly = await createUser(h.db, { role: "read_only", name: "Rory Readonly" });
});
afterAll(async () => {
  await h.close();
});

describe("Scenario 1 — lead creation", () => {
  it("creates a lead, lists it, opens it, changes its stage, and the change persists", async () => {
    const lead = await createLead(h.db, employee, {
      name: "Jordan Smith",
      email: "Jordan@Example.test",
      phone: "(555) 010-2000",
      clientType: "individual",
      requestedServices: ["individual_tax", "tax_consulting"],
      source: "referral",
      priority: "high",
      estimatedValueCents: "1,250.50",
      followUpDate: "2027-01-10",
    });
    expect(lead.leadNumber).toBe(1);
    expect(lead).toMatchObject({ email: "jordan@example.test", priority: "high", estimatedValueCents: 125050, serviceInterest: "individual_tax", ownerId: employee.userId });

    expect((await listLeads(h.db, employee, { q: "jordan" })).map((l) => l.id)).toContain(lead.id);
    expect((await listLeads(h.db, employee, { priority: "high", source: "referral" })).map((l) => l.id)).toContain(lead.id);

    await setLeadStatus(h.db, employee, lead.id, { status: "consultation_scheduled", note: "Booked for Friday" });
    const reloaded = await getLead(h.db, employee, lead.id);
    expect(reloaded.status).toBe("consultation_scheduled");

    const history = await listStatusHistory(h.db, employee, "lead", lead.id);
    expect(history.map((x) => [x.oldStatus, x.newStatus])).toEqual([
      [null, "new"],
      ["new", "consultation_scheduled"],
    ]);
    expect(history[1]!.changedByName).toBe("Eve Employee");
  });

  it("records calls/emails/meetings, updates last-contacted and the follow-up", async () => {
    const lead = await createLead(h.db, employee, { name: "Call Me" });
    await addLeadActivity(h.db, employee, lead.id, { type: "call", body: "Left a voicemail", occurredAt: "2026-11-12T10:30", followUpDate: "2026-11-15" });
    const after = await getLead(h.db, employee, lead.id);
    expect(after.status).toBe("contacted"); // first contact moves a new lead to Contacted
    expect(after.lastContactedAt).not.toBeNull();
    expect(after.followUpDate).toBe("2026-11-15");
    const timeline = await listEntityTimeline(h.db, employee, "lead", lead.id);
    expect(timeline.some((t) => t.type === "call" && t.body === "Left a voicemail")).toBe(true);
  });

  it("requires a reason to mark a lead lost; only assign-permitted roles reassign", async () => {
    const lead = await createLead(h.db, employee, { name: "Maybe Later" });
    await expect(setLeadStatus(h.db, employee, lead.id, { status: "lost" })).rejects.toBeInstanceOf(ValidationError);
    await setLeadStatus(h.db, employee, lead.id, { status: "lost", lostReason: "Chose another firm" });
    expect((await getLead(h.db, employee, lead.id)).lostReason).toBe("Chose another firm");
    await expect(updateLead(h.db, employee, lead.id, { name: "Maybe Later", ownerId: manager.userId })).rejects.toBeInstanceOf(ForbiddenError);
    await updateLead(h.db, manager, lead.id, { name: "Maybe Later", ownerId: employee.userId, notes: "Reassigned" });
  });

  it("read-only users can see leads but not change them; only export-permitted roles export", async () => {
    expect((await listLeads(h.db, readOnly)).length).toBeGreaterThan(0);
    await expect(createLead(h.db, readOnly, { name: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(exportLeadsCsv(h.db, employee)).rejects.toBeInstanceOf(ForbiddenError);
    const csv = await exportLeadsCsv(h.db, manager);
    expect(csv.split("\r\n")[0]).toContain('"Number","Name"');
    expect(csv).toContain("Jordan Smith");
  });

  it("neutralizes spreadsheet formulas in the CSV export", async () => {
    await createLead(h.db, employee, { name: "=HYPERLINK(\"http://evil\")" });
    expect(await exportLeadsCsv(h.db, admin)).toContain(`"'=HYPERLINK(""http://evil"")"`);
  });
});

describe("Scenario 2 — lead conversion", () => {
  it("converts a lead into a new client, links both ways, marks Won, and refuses a second conversion", async () => {
    const lead = await createLead(h.db, employee, { name: "Pat Rivera", company: "Rivera Bakery LLC", email: "pat@rivera.test", clientType: "business" });
    const { clientId, created } = await convertLead(h.db, employee, lead.id, {
      mode: "new",
      type: "business",
      displayName: "Rivera Bakery LLC",
      email: "pat@rivera.test",
      phone: "555-010-3000",
    });
    expect(created).toBe(true);

    const client = await getClient(h.db, employee, clientId);
    expect(client).toMatchObject({ displayName: "Rivera Bakery LLC", sourceLeadId: lead.id, status: "onboarding", onboardingStatus: "not_started" });
    expect(client.clientNumber).toBe(1);

    const converted = await getLead(h.db, employee, lead.id);
    expect(converted).toMatchObject({ status: "converted", convertedClientId: clientId, convertedById: employee.userId });
    expect(converted.convertedAt).not.toBeNull();
    // The original lead and its history are preserved.
    expect((await listStatusHistory(h.db, employee, "lead", lead.id)).at(-1)!.newStatus).toBe("converted");

    const before = (await h.db.select().from(clients)).length;
    await expect(convertLead(h.db, employee, lead.id, { mode: "new", type: "business", displayName: "Rivera Bakery LLC", confirmNotDuplicate: "on" })).rejects.toBeInstanceOf(AlreadyConvertedError);
    expect((await h.db.select().from(clients)).length).toBe(before); // no duplicate client
  });

  it("detects a likely duplicate and requires linking or explicit confirmation", async () => {
    const lead = await createLead(h.db, employee, { name: "Pat R.", email: "PAT@rivera.test" });
    const dupes = await findLeadDuplicates(h.db, employee, lead.id);
    expect(dupes).toHaveLength(1);
    expect(dupes[0]!.reasons).toContain("email");

    await expect(convertLead(h.db, employee, lead.id, { mode: "new", type: "individual", displayName: "Pat R.", email: "pat@rivera.test" })).rejects.toBeInstanceOf(ValidationError);
    const { clientId, created } = await convertLead(h.db, employee, lead.id, { mode: "existing", clientId: dupes[0]!.id });
    expect(created).toBe(false);
    expect(clientId).toBe(dupes[0]!.id);
    expect((await listClientTimeline(h.db, employee, clientId)).some((t) => t.body?.includes("Linked lead"))).toBe(true);
  });

  it("rolls back completely if the conversion fails midway", async () => {
    const lead = await createLead(h.db, employee, { name: "Rollback Person" });
    // An account manager from nowhere makes client creation fail after validation.
    await expect(
      convertLead(h.db, employee, lead.id, { mode: "new", type: "individual", displayName: "Rollback Person", accountManagerId: "00000000-0000-4000-8000-000000000000" }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect((await getLead(h.db, employee, lead.id)).status).toBe("new");
    expect(await h.db.select().from(clients).where(eq(clients.displayName, "Rollback Person"))).toEqual([]);
  });

  it("read-only users cannot convert", async () => {
    const lead = await createLead(h.db, employee, { name: "No Convert" });
    await expect(convertLead(h.db, readOnly, lead.id, { mode: "new", type: "individual", displayName: "No Convert" })).rejects.toBeInstanceOf(ForbiddenError);
    const [row] = await h.db.select().from(leads).where(and(eq(leads.id, lead.id)));
    expect(row!.status).toBe("new");
  });
});

describe("Scenario 3 — client management", () => {
  let clientId: string;
  beforeAll(async () => {
    const lead = await createLead(h.db, manager, { name: "Acme Co" });
    clientId = (await convertLead(h.db, manager, lead.id, { mode: "new", type: "business", displayName: "Acme Co", confirmNotDuplicate: "on" })).clientId;
  });

  it("updates client information and assigns an account manager; changes persist", async () => {
    await updateClient(h.db, manager, clientId, { type: "business", displayName: "Acme Company", email: "books@acme.test", address: "1 Main St", status: "onboarding", accountManagerId: employee.userId, notes: "Prefers email" });
    const c = await getClient(h.db, manager, clientId);
    expect(c).toMatchObject({ displayName: "Acme Company", email: "books@acme.test", address: "1 Main St", accountManagerId: employee.userId, notes: "Prefers email" });
    // The account manager can now see the client.
    expect((await listClients(h.db, employee)).some((x) => x.id === clientId)).toBe(true);
  });

  it("adds business contacts with roles; one primary contact", async () => {
    await saveClientContact(h.db, manager, clientId, null, { name: "Ann Owner", role: "owner", email: "ann@acme.test", isPrimary: "on" });
    await saveClientContact(h.db, manager, clientId, null, { name: "Bill Payer", role: "billing", isPrimary: "on" });
    const contacts = await listClientContacts(h.db, manager, clientId);
    expect(contacts.map((c) => [c.name, c.role, c.isPrimary])).toEqual([
      ["Bill Payer", "billing", true],
      ["Ann Owner", "owner", false],
    ]);
  });

  it("onboarding follows the checklist and is never complete just because the client exists", async () => {
    expect((await getClient(h.db, manager, clientId)).onboardingStatus).toBe("not_started");
    expect(await addOnboardingItem(h.db, manager, clientId, { title: "Business details form", kind: "information" })).toBe("information_requested");
    expect(await addOnboardingItem(h.db, manager, clientId, { title: "Prior-year return", kind: "document" })).toBe("information_requested");
    const items = await listOnboardingItems(h.db, manager, clientId);
    expect(await setOnboardingItemStatus(h.db, employee, clientId, items[0]!.id, "received")).toBe("awaiting_documents");
    expect(await setOnboardingItemStatus(h.db, employee, clientId, items[1]!.id, "received")).toBe("under_verification");
    await expect(setOnboardingItemStatus(h.db, employee, clientId, items[1]!.id, "waived")).rejects.toBeInstanceOf(ForbiddenError);
    await setOnboardingItemStatus(h.db, employee, clientId, items[0]!.id, "verified");
    expect(await setOnboardingItemStatus(h.db, employee, clientId, items[1]!.id, "verified")).toBe("completed");
    const c = await getClient(h.db, manager, clientId);
    expect(c).toMatchObject({ onboardingStatus: "completed", status: "active" }); // promoted from onboarding
  });

  it("derives onboarding status from the checklist", () => {
    expect(deriveOnboardingStatus([])).toBe("not_started");
    expect(deriveOnboardingStatus([{ kind: "document", status: "requested" }])).toBe("awaiting_documents");
    expect(deriveOnboardingStatus([{ kind: "document", status: "waived" }])).toBe("completed");
  });

  it("archives instead of deleting; only delete-permitted roles", async () => {
    await expect(setClientArchived(h.db, employee, clientId, true)).rejects.toBeInstanceOf(ForbiddenError);
    await setClientArchived(h.db, admin, clientId, true);
    expect((await listClients(h.db, admin)).some((c) => c.id === clientId)).toBe(false);
    expect((await listClients(h.db, admin, { includeArchived: true })).some((c) => c.id === clientId)).toBe(true);
    await setClientArchived(h.db, admin, clientId, false);
  });
});
