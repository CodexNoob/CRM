import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "@/db";
import type { Actor } from "@/lib/auth/actor";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { createClient } from "@/services/clients";
import { createEngagement, createTask, setEngagementStatus } from "@/services/engagements";
import { getClientTeam, getLatestTaxEngagement, getPracticeCounts, getWorkload, listClientActivity, listClientsOverview, listRecentClientActivity } from "@/services/insights";
import { convertLead, createLead, setLeadStatus } from "@/services/leads";
import { listTasks } from "@/services/tasks";
import { listOpenEngagements } from "@/services/engagements";
import { listWork, TAX_SERVICES } from "@/services/practice";
import { getNotifications, globalSearch } from "@/services/workspace";
import { createTestDb, createUser } from "./helpers";

let h: DbHandle;
let admin: Actor, prepA: Actor, prepB: Actor, portal: Actor;
let clientA: string, clientB: string, engA: string, engB: string;

beforeAll(async () => {
  h = await createTestDb();
  admin = await createUser(h.db, { role: "admin", name: "Ada Admin" });
  prepA = await createUser(h.db, { role: "employee", name: "Pat A" });
  prepB = await createUser(h.db, { role: "employee", name: "Pat B" });
  clientA = (await createClient(h.db, admin, { type: "individual", displayName: "Alpha Person", email: "alpha@example.test" })).id;
  clientB = (await createClient(h.db, admin, { type: "business", displayName: "Beta Corp" })).id;
  portal = await createUser(h.db, { role: "client", clientId: clientA });
  engA = (await createEngagement(h.db, admin, clientA, { title: "2026 Form 1040", serviceType: "individual_tax", taxYear: 2026, status: "in_progress", ownerId: prepA.userId, dueDate: "2020-01-01" })).id;
  engB = (await createEngagement(h.db, admin, clientB, { title: "2026 Form 1120-S", serviceType: "business_tax", taxYear: 2026, ownerId: prepB.userId })).id;
  await createTask(h.db, admin, engA, { title: "Upload W-2", isClientTask: true });
  await createTask(h.db, admin, engA, { title: "Review carryover", assigneeId: prepA.userId, dueDate: "2020-01-02" });
});
afterAll(async () => {
  await h.close();
});

describe("activity feeds", () => {
  it("scope client activity to visible clients", async () => {
    const all = await listRecentClientActivity(h.db, admin, 50);
    expect(all.some((a) => a.clientName === "Beta Corp")).toBe(true);
    const mine = await listRecentClientActivity(h.db, prepA, 50);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((a) => a.clientId === clientA)).toBe(true);
    // Task and engagement events resolve to their client.
    expect((await listClientActivity(h.db, admin, clientA)).map((a) => a.action)).toEqual(expect.arrayContaining(["client.create", "engagement.create", "task.create"]));
    await expect(listClientActivity(h.db, prepA, clientB)).rejects.toBeInstanceOf(NotFoundError);
    await expect(listRecentClientActivity(h.db, portal)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("dashboard data", () => {
  it("computes workload, counts and the client list with summary columns", async () => {
    const w = await getWorkload(h.db, admin);
    expect(w.find((r) => r.name === "Pat A")).toMatchObject({ openEngagements: 1, overdue: 1, openTasks: 1 });
    expect(await getPracticeCounts(h.db, prepA)).toMatchObject({ pendingReturns: 1, openClientRequests: 1 });
    const rows = await listClientsOverview(h.db, prepA);
    expect(rows.map((r) => r.displayName)).toEqual(["Alpha Person"]);
    expect(rows[0]).toMatchObject({ openEngagements: 1, portalUsers: 1 });
    expect(rows[0]!.team).toContain("Pat A");
    expect((await getClientTeam(h.db, admin, clientA)).map((m) => m.name)).toEqual(expect.arrayContaining(["Ada Admin", "Pat A"]));
    expect(await getLatestTaxEngagement(h.db, admin, clientA)).toMatchObject({ taxYear: 2026, status: "in_progress" });
    expect((await listTasks(h.db, admin, { clientId: clientB })).length).toBe(0);
    // Correlated counts in joined queries resolve to the right rows.
    expect((await listWork(h.db, admin, { services: TAX_SERVICES })).find((w) => w.id === engA)?.openTasks).toBe(2);
    expect((await listOpenEngagements(h.db, admin)).find((e) => e.id === engA)?.openTaskCount).toBe(2);
  });

  it("derives notifications from live data", async () => {
    const n = await getNotifications(h.db, prepA);
    expect(n.map((i) => i.id)).toEqual(expect.arrayContaining(["overdue", "tasks"]));
    expect(n.find((i) => i.id === "overdue")?.count).toBe(1);
    await expect(getNotifications(h.db, portal)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("global search", () => {
  it("finds records the actor can see, and nothing else", async () => {
    const r = await globalSearch(h.db, prepA, "form");
    expect(r.engagements.map((e) => e.title)).toEqual(["2026 Form 1040"]);
    expect((await globalSearch(h.db, admin, "beta")).clients.map((c) => c.name)).toEqual(["Beta Corp"]);
    expect((await globalSearch(h.db, prepA, "beta")).clients).toEqual([]);
    expect((await globalSearch(h.db, admin, "a")).clients).toEqual([]); // too short
    expect((await globalSearch(h.db, admin, "%")).clients).toEqual([]); // wildcards are literal
    await expect(globalSearch(h.db, portal, "alpha")).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("single-field updates used by bulk actions", () => {
  it("respect access and validation", async () => {
    await setEngagementStatus(h.db, prepA, engA, "in_review");
    await expect(setEngagementStatus(h.db, prepA, engB, "filed")).rejects.toBeInstanceOf(NotFoundError);
    await expect(setEngagementStatus(h.db, admin, engA, "bogus" as never)).rejects.toBeInstanceOf(ValidationError);
    const lead = await createLead(h.db, admin, { name: "Lee" });
    await setLeadStatus(h.db, prepA, lead.id, "contacted");
    await convertLead(h.db, admin, lead.id);
    await expect(setLeadStatus(h.db, admin, lead.id, "lost")).rejects.toBeInstanceOf(ValidationError);
    await expect(setLeadStatus(h.db, portal, lead.id, "lost")).rejects.toBeInstanceOf(ForbiddenError);
  });
});
