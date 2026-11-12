import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DbHandle } from "@/db";
import { tasks } from "@/db/schema";
import { can } from "@/lib/auth/permissions";
import type { Actor } from "@/lib/auth/actor";
import { navForRole } from "@/components/staff/nav-config";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { addOnboardingItem, createClient, getClient, listOnboardingItems, setOnboardingItemStatus, updateClient } from "@/services/clients";
import { getWorkspaceOverview } from "@/services/dashboard";
import { createEngagement, getEngagement, setEngagementStatus } from "@/services/engagements";
import { convertLead, createLead, exportLeadsCsv, getLead, setLeadStatus } from "@/services/leads";
import { createTask, getTask, listTasks, setTaskStatus } from "@/services/tasks";
import { getNotifications } from "@/services/workspace";
import { generateWorkflow, listTemplates, saveTemplate } from "@/services/workflows";
import { createTestDb, createUser } from "./helpers";

/**
 * Spec scenarios 7 (dashboard reflects real records) and 8 (permissions), plus the full
 * lifecycle from section 15: lead → client → engagement → generated tasks → review → closed.
 */

let h: DbHandle;
let admin: Actor, manager: Actor, employee: Actor, otherEmployee: Actor, readOnly: Actor;
const NOW = new Date("2027-01-15T15:00:00Z"); // firm "today" = 2027-01-15

beforeAll(async () => {
  h = await createTestDb();
  admin = await createUser(h.db, { role: "admin", name: "Ada Admin" });
  manager = await createUser(h.db, { role: "manager", name: "Max Manager" });
  employee = await createUser(h.db, { role: "employee", name: "Eve Employee" });
  otherEmployee = await createUser(h.db, { role: "employee", name: "Oli Other" });
  readOnly = await createUser(h.db, { role: "read_only", name: "Rory Readonly" });
});
afterAll(async () => {
  await h.close();
});

const kpis = async (a: Actor) => (await getWorkspaceOverview(h.db, a, { now: NOW })).kpis;

describe("Section 15 + Scenario 7 — the full lifecycle, reflected on the dashboard", () => {
  it("runs lead → client → engagement → tasks → review → closed, and every KPI follows real records", async () => {
    const k0 = await kpis(manager);

    // 1–2. A prospect arrives and is qualified.
    const lead = await createLead(h.db, employee, { name: "Dana Doe", email: "dana@example.test", requestedServices: ["individual_tax"] });
    expect((await kpis(manager)).newLeads).toBe(k0.newLeads + 1);
    await setLeadStatus(h.db, employee, lead.id, "contacted");
    await setLeadStatus(h.db, employee, lead.id, "qualified");
    expect((await kpis(manager)).newLeads).toBe(k0.newLeads);

    // 3. Controlled conversion.
    const { clientId } = await convertLead(h.db, employee, lead.id, { mode: "new", type: "individual", displayName: "Dana Doe", email: "dana@example.test" });
    expect((await getLead(h.db, employee, lead.id)).status).toBe("converted");
    const k1 = await kpis(manager);
    expect(k1.totalClients).toBe(k0.totalClients + 1);
    expect(k1.activeClients).toBe(k0.activeClients); // onboarding, not active yet

    // Onboarding: a requested document counts as pending until verified.
    await addOnboardingItem(h.db, employee, clientId, { title: "Photo ID", kind: "document" });
    expect((await kpis(manager)).pendingClientDocuments).toBe(k1.pendingClientDocuments + 1);
    const [item] = await listOnboardingItems(h.db, employee, clientId);
    await setOnboardingItemStatus(h.db, employee, clientId, item!.id, "received");
    await setOnboardingItemStatus(h.db, manager, clientId, item!.id, "verified");
    expect((await getClient(h.db, manager, clientId)).status).toBe("active");
    expect((await kpis(manager)).activeClients).toBe(k1.activeClients + 1);

    // 4–5. Engagement with a manager and staff.
    const e = await createEngagement(h.db, manager, clientId, { title: "Annual Tax Preparation 2026", serviceType: "individual_tax", ownerId: manager.userId, staffIds: [employee.userId], startDate: "2027-01-10" });
    expect((await kpis(manager)).activeEngagements).toBe(k1.activeEngagements + 1);

    // 6. Tasks from the template (due dates relative to today).
    const tpl = (await listTemplates(h.db, manager)).find((t) => t.name === "Annual Tax Preparation")!;
    const { taskIds } = await generateWorkflow(h.db, manager, e.id, { templateId: tpl.id, overrides: [{ sequence: 1, dueDate: "2027-01-15" }, { sequence: 2, dueDate: "2027-01-10" }] }, "2027-01-15");
    const k2 = await kpis(manager);
    expect(k2.tasksDueToday).toBeGreaterThanOrEqual(1);
    expect(k2.overdueTasks).toBeGreaterThanOrEqual(1);
    // The assigned employee was notified.
    expect((await getNotifications(h.db, employee)).some((n) => /assigned/i.test(`${n.label} ${n.detail}`))).toBe(true);

    // 7. Employees work through the tasks in dependency order.
    const ordered = (await h.db.select().from(tasks).where(eq(tasks.engagementId, e.id))).sort((a, b) => a.sequence! - b.sequence!);
    expect(ordered.map((t) => t.id).sort()).toEqual([...taskIds].sort());
    for (const t of ordered) await setTaskStatus(h.db, manager, t.id, "completed");
    const k3 = await kpis(manager);
    expect(k3.overdueTasks).toBe(k2.overdueTasks - 1);

    // 8. Ready for review → the manager reviews → completed → closed. Nothing closed automatically.
    let detail = await getEngagement(h.db, manager, e.id, "2027-01-15");
    expect(detail.progress.readyForReview).toBe(true);
    expect(detail.engagement.status).toBe("active");
    expect(k3.awaitingReview).toBeGreaterThanOrEqual(1);
    expect((await getNotifications(h.db, manager)).some((n) => /review/i.test(`${n.label} ${n.detail}`))).toBe(true);
    await setEngagementStatus(h.db, employee, e.id, "in_review");
    await setEngagementStatus(h.db, manager, e.id, "completed");
    await setEngagementStatus(h.db, manager, e.id, "closed");
    detail = await getEngagement(h.db, manager, e.id);
    expect(detail.engagement.status).toBe("closed");
    expect((await kpis(manager)).activeEngagements).toBe(k1.activeEngagements);
  });
});

describe("Scenario 8 — permissions", () => {
  let mineClient: string, notMineClient: string, notMineTask: string;
  beforeAll(async () => {
    mineClient = (await createClient(h.db, employee, { type: "individual", displayName: "Employee's Client" })).id;
    notMineClient = (await createClient(h.db, manager, { type: "individual", displayName: "Not Assigned Client" })).id;
    const e = await createEngagement(h.db, manager, notMineClient, { title: "Private engagement", serviceType: "other", ownerId: manager.userId });
    notMineTask = (await createTask(h.db, manager, { title: "Manager-only task" }, { engagementId: e.id })).id;
  });

  it("restricts navigation per role (admin-only modules)", () => {
    const labels = (isAdmin: boolean) => navForRole(isAdmin).flatMap((s) => s.items.map((i) => i.label));
    expect(labels(true)).toContain("Team Members");
    expect(labels(false)).not.toContain("Team Members");
    expect(labels(false)).not.toContain("Activity Logs");
  });

  it("the permission matrix gives each role the right actions", () => {
    expect(can(admin, "leads", "export")).toBe(true);
    expect(can(manager, "engagements", "approve")).toBe(true);
    expect(can(employee, "engagements", "approve")).toBe(false);
    expect(can(employee, "leads", "export")).toBe(false);
    expect(can(readOnly, "clients", "view")).toBe(true);
    expect(can(readOnly, "clients", "edit")).toBe(false);
    expect(can(readOnly, "billing", "view")).toBe(false); // finance isn't implied by visibility
  });

  it("refuses unauthorized server-side operations", async () => {
    await expect(updateClient(h.db, readOnly, mineClient, { type: "individual", displayName: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createEngagement(h.db, readOnly, mineClient, { title: "x", serviceType: "other", ownerId: manager.userId })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(exportLeadsCsv(h.db, employee)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(saveTemplate(h.db, employee, null, { name: "x", serviceType: "other", steps: [{ title: "a" }] })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("enforces record-level access: employees see only assigned clients and their work", async () => {
    await expect(getClient(h.db, employee, notMineClient)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getTask(h.db, employee, notMineTask)).rejects.toBeInstanceOf(NotFoundError);
    await expect(setTaskStatus(h.db, employee, notMineTask, "completed")).rejects.toBeInstanceOf(NotFoundError);
    expect((await listTasks(h.db, employee, { status: "all" })).some((t) => t.id === notMineTask)).toBe(false);
    expect((await listTasks(h.db, readOnly, { status: "all" })).some((t) => t.id === notMineTask)).toBe(true); // read-only sees, can't change
    await expect(setTaskStatus(h.db, readOnly, notMineTask, "completed")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getClient(h.db, otherEmployee, mineClient)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("an employee's dashboard only counts their assigned clients", async () => {
    const mine = await kpis(employee);
    const firm = await kpis(admin);
    expect(mine.totalClients).toBeLessThan(firm.totalClients);
  });
});
