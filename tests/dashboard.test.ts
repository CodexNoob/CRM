import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "@/db";
import type { Actor } from "@/lib/auth/actor";
import { ForbiddenError } from "@/lib/errors";
import { createClient } from "@/services/clients";
import { firmToday, getDashboard, getWorkspaceOverview } from "@/services/dashboard";
import { listWorkspaceActivity } from "@/services/insights";
import { getNotifications } from "@/services/workspace";
import { createEngagement, createTask, getEngagement } from "@/services/engagements";
import { createTestDb, createUser } from "./helpers";

const NOW = new Date("2027-03-01T15:00:00Z");
let h: DbHandle;
let admin: Actor, prepA: Actor, prepB: Actor;

beforeAll(async () => {
  h = await createTestDb();
  admin = await createUser(h.db, { role: "admin" });
  prepA = await createUser(h.db, { role: "employee" });
  prepB = await createUser(h.db, { role: "employee" });
  const a = await createClient(h.db, admin, { type: "individual", displayName: "Alpha Client", status: "active" });
  const b = await createClient(h.db, admin, { type: "individual", displayName: "Beta Client", status: "active" });
  const e = (clientId: string, ownerId: string, status: string, dueDate?: string) =>
    createEngagement(h.db, admin, clientId, { title: `${status} ${dueDate ?? ""}`, serviceType: "individual_tax", status, ownerId, dueDate });

  await e(a.id, prepA.userId, "in_progress", "2027-02-20"); // overdue
  await e(a.id, prepA.userId, "waiting_on_client", "2027-03-10"); // due soon
  await e(a.id, prepA.userId, "filed", "2027-02-01"); // done: never overdue
  const late = await e(b.id, prepB.userId, "in_review", "2027-02-25"); // overdue, other preparer
  await e(b.id, prepB.userId, "not_started", "2027-06-01"); // not soon
  await createTask(h.db, admin, late.id, { title: "Review", assigneeId: prepB.userId });
});
afterAll(async () => {
  await h.close();
});

describe("dashboard", () => {
  it("computes firm-wide metrics for admins", async () => {
    const d = await getDashboard(h.db, admin, { now: NOW });
    expect(d.today).toBe("2027-03-01");
    expect(d.metrics).toMatchObject({ open: 4, overdue: 2, dueSoon: 1, waitingOnClient: 1, activeClients: 2 });
    expect(d.deadlines.map((x) => x.dueDate)).toEqual(["2027-02-20", "2027-02-25", "2027-03-10"]);
    expect(d.statusBreakdown.find((s) => s.status === "in_review")?.count).toBe(1);
    expect(d.statusBreakdown.some((s) => s.status === "filed")).toBe(false);
  });

  it("scopes a preparer to their assigned clients", async () => {
    const d = await getDashboard(h.db, prepA, { now: NOW });
    expect(d.metrics).toMatchObject({ open: 2, overdue: 1, dueSoon: 1, activeClients: 1 });
    expect(d.deadlines.every((x) => x.clientName === "Alpha Client")).toBe(true);
    expect(d.recentClients.map((c) => c.displayName)).toEqual(["Alpha Client"]);
  });

  it("shows tasks assigned to me, and assigning a task grants access to its engagement", async () => {
    const d = await getDashboard(h.db, prepB, { now: NOW });
    expect(d.myTasks.map((t) => t.title)).toEqual(["Review"]);
    expect(d.metrics.myOpenTasks).toBe(1);
    await expect(getEngagement(h.db, prepB, d.myTasks[0]!.engagementId)).resolves.toBeTruthy();
  });

  it("filters to my engagements and refuses portal users", async () => {
    const mine = await getDashboard(h.db, admin, { now: NOW, mine: true });
    expect(mine.metrics.open).toBe(0);
    const client = await createUser(h.db, { role: "client" });
    await expect(getDashboard(h.db, client)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("builds the workspace overview, activity feed and assignment notifications from real records", async () => {
    const o = await getWorkspaceOverview(h.db, admin, { now: NOW });
    expect(o.kpis).toMatchObject({ totalClients: 2, activeClients: 2, activeEngagements: 4, newLeads: 0 });
    expect(o.tasks.teamOpen).toBe(1);
    expect(o.kpis.awaitingReview).toBe(1); // the in_review engagement
    const scoped = await getWorkspaceOverview(h.db, prepA, { now: NOW });
    expect(scoped.kpis.totalClients).toBe(1);
    expect(scoped.tasks.teamOpen).toBe(0);

    const feed = await listWorkspaceActivity(h.db, admin);
    expect(feed.some((a) => a.entityType === "engagement" && a.entityName)).toBe(true);
    expect(feed.some((a) => a.entityType === "task" && a.type === "assignment" && a.entityName === "Review")).toBe(true);
    expect((await listWorkspaceActivity(h.db, prepA)).every((a) => a.entityType !== "task")).toBe(true); // B's task is not visible to A

    const n = await getNotifications(h.db, prepB);
    expect(n.some((i) => i.label === "You were assigned to Review")).toBe(true);
    // prepA manages engagements (assigned by the admin) but was never given B's task.
    const a = await getNotifications(h.db, prepA);
    expect(a.some((i) => i.label.startsWith("You were assigned") && i.href.startsWith("/staff/engagements/"))).toBe(true);
    expect(a.some((i) => i.label === "You were assigned to Review")).toBe(false);
  });

  it("uses the firm's time zone for today", () => {
    // 02:00 UTC on Mar 2 is still Mar 1 in New York.
    expect(firmToday(new Date("2027-03-02T02:00:00Z"), "America/New_York")).toBe("2027-03-01");
  });
});
