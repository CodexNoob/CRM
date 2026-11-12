import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { DbHandle } from "@/db";
import { tasks, workflowInstances } from "@/db/schema";
import type { Actor } from "@/lib/auth/actor";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { createClient } from "@/services/clients";
import {
  createEngagement,
  getEngagement,
  listClientEngagements,
  listEngagements,
  overrideWorkStart,
  setEngagementStatus,
  setProposalStatus,
} from "@/services/engagements";
import {
  addChecklistItem,
  addTaskComment,
  assignTask,
  createTask,
  getTask,
  listTasks,
  setChecklistItemDone,
  setTaskStatus,
  updateTask,
} from "@/services/tasks";
import { listEntityTimeline } from "@/services/timeline";
import { DuplicateWorkflowError, generateWorkflow, listTemplates, previewWorkflow } from "@/services/workflows";
import { createTestDb, createUser } from "./helpers";

/** Spec scenarios 4–6 (engagement creation, workflow generation, task management) on real services + Postgres. */

let h: DbHandle;
let admin: Actor, manager: Actor, employee: Actor, employee2: Actor, readOnly: Actor;
let clientId: string;

beforeAll(async () => {
  h = await createTestDb();
  admin = await createUser(h.db, { role: "admin", name: "Ada Admin" });
  manager = await createUser(h.db, { role: "manager", name: "Max Manager" });
  employee = await createUser(h.db, { role: "employee", name: "Eve Employee" });
  employee2 = await createUser(h.db, { role: "employee", name: "Earl Employee" });
  readOnly = await createUser(h.db, { role: "read_only", name: "Rory Readonly" });
  clientId = (await createClient(h.db, manager, { type: "individual", displayName: "John Smith" })).id;
});
afterAll(async () => {
  await h.close();
});

describe("Scenario 4 — engagement creation", () => {
  it("creates an Annual Tax Preparation engagement with manager + staff; it shows on lists and the client profile", async () => {
    const e = await createEngagement(h.db, manager, clientId, {
      title: "Annual Tax Preparation 2026",
      serviceType: "individual_tax",
      taxYear: "2026",
      ownerId: manager.userId,
      staffIds: [employee.userId],
      startDate: "2027-01-15",
      dueDate: "2027-04-15",
      feeCents: "650",
      billingFrequency: "one_time",
      description: "Federal and state 1040",
    });
    expect(e).toMatchObject({ engagementNumber: 1, status: "active", proposalStatus: "not_required", feeCents: 65000, ownerId: manager.userId });

    const detail = await getEngagement(h.db, manager, e.id);
    expect(detail.team.map((m) => [m.name, m.role]).sort()).toEqual([
      ["Eve Employee", "staff"],
      ["Max Manager", "manager"],
    ]);
    expect((await listEngagements(h.db, manager)).map((x) => x.id)).toContain(e.id);
    expect((await listEngagements(h.db, manager, { staffId: employee.userId })).map((x) => x.id)).toContain(e.id);
    expect((await listClientEngagements(h.db, manager, clientId)).map((x) => x.id)).toContain(e.id);
    // The staff member was given access to the client and notified (assignment on the timeline).
    expect((await listEngagements(h.db, employee)).map((x) => x.id)).toContain(e.id);
    expect((await listEntityTimeline(h.db, manager, "engagement", e.id)).some((t) => t.type === "assignment" && (t.metadata as { userId?: string })?.userId === employee.userId)).toBe(true);
  });

  it("one client can have several engagements (tax + bookkeeping)", async () => {
    await createEngagement(h.db, manager, clientId, { title: "Monthly Bookkeeping Jan–Dec 2026", serviceType: "bookkeeping", ownerId: manager.userId, periodStart: "2026-01-01", periodEnd: "2026-12-31" });
    expect((await listClientEngagements(h.db, manager, clientId)).length).toBe(2);
  });

  it("validates dates, people and permissions", async () => {
    await expect(createEngagement(h.db, manager, clientId, { title: "x", serviceType: "other", ownerId: manager.userId, startDate: "2027-05-01", dueDate: "2027-04-01" })).rejects.toBeInstanceOf(ValidationError);
    await expect(createEngagement(h.db, manager, clientId, { title: "x", serviceType: "other", ownerId: readOnly.userId })).rejects.toBeInstanceOf(ValidationError);
    await expect(createEngagement(h.db, readOnly, clientId, { title: "x", serviceType: "other", ownerId: manager.userId })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("keeps proposal acceptance separate: no work before acceptance unless a manager overrides", async () => {
    const e = await createEngagement(h.db, manager, clientId, { title: "Consulting 2027", serviceType: "tax_consulting", ownerId: manager.userId, proposalStatus: "sent" });
    expect(e.status).toBe("awaiting_acceptance");
    await expect(setEngagementStatus(h.db, manager, e.id, "in_progress")).rejects.toBeInstanceOf(ValidationError);
    const t = await createTask(h.db, manager, { title: "Kick-off call", assigneeId: employee.userId }, { engagementId: e.id });
    await expect(setTaskStatus(h.db, employee, t.id, "in_progress")).rejects.toBeInstanceOf(ValidationError);

    await expect(setProposalStatus(h.db, employee, e.id, "accepted")).rejects.toBeInstanceOf(ForbiddenError);
    await setProposalStatus(h.db, manager, e.id, "accepted", "2027-01-02");
    const after = (await getEngagement(h.db, manager, e.id)).engagement;
    expect(after).toMatchObject({ proposalStatus: "accepted", status: "active", acceptedOn: "2027-01-02" });
    await setTaskStatus(h.db, employee, t.id, "in_progress");

    const e2 = await createEngagement(h.db, manager, clientId, { title: "Rush job", serviceType: "other", ownerId: manager.userId, proposalStatus: "draft" });
    await expect(overrideWorkStart(h.db, employee, e2.id, "client asked")).rejects.toBeInstanceOf(ForbiddenError);
    await overrideWorkStart(h.db, manager, e2.id, "Client approved by phone");
    await setEngagementStatus(h.db, manager, e2.id, "in_progress");
  });
});

describe("Scenario 5 — workflow generation", () => {
  let engagementId: string;
  beforeAll(async () => {
    engagementId = (await createEngagement(h.db, manager, clientId, { title: "Tax 2026 (workflow)", serviceType: "individual_tax", ownerId: manager.userId, staffIds: [employee.userId], startDate: "2027-01-10" })).id;
  });

  it("previews the Annual Tax Preparation tasks with assignees and due dates", async () => {
    const tpl = (await listTemplates(h.db, manager)).find((t) => t.name === "Annual Tax Preparation")!;
    expect(tpl.steps).toHaveLength(10);
    const p = await previewWorkflow(h.db, manager, engagementId, tpl.id, "2027-01-01");
    expect(p.alreadyGenerated).toBe(false);
    expect(p.planned[0]).toMatchObject({ sequence: 1, title: "Request tax documents", assigneeId: employee.userId, dueDate: "2027-01-13" });
    expect(p.planned[5]).toMatchObject({ title: "Internal quality review", assigneeId: manager.userId }); // reviewer falls back to the manager
  });

  it("generates linked tasks once, with dependencies; a second attempt creates nothing", async () => {
    const tpl = (await listTemplates(h.db, manager)).find((t) => t.name === "Annual Tax Preparation")!;
    await expect(generateWorkflow(h.db, employee, engagementId, { templateId: tpl.id })).rejects.toBeInstanceOf(ForbiddenError);
    const res = await generateWorkflow(h.db, manager, engagementId, { templateId: tpl.id, overrides: [{ sequence: 1, assigneeId: employee2.userId, dueDate: "2027-01-20" }] }, "2027-01-01");
    expect(res.taskIds).toHaveLength(10);

    const generated = await h.db.select().from(tasks).where(eq(tasks.workflowInstanceId, res.workflowInstanceId));
    expect(generated).toHaveLength(10);
    expect(generated.every((t) => t.engagementId === engagementId && t.clientId === clientId)).toBe(true);
    const first = generated.find((t) => t.sequence === 1)!;
    expect(first).toMatchObject({ assigneeId: employee2.userId, dueDate: "2027-01-20" });

    await expect(generateWorkflow(h.db, manager, engagementId, { templateId: tpl.id })).rejects.toBeInstanceOf(DuplicateWorkflowError);
    expect(await h.db.select().from(tasks).where(eq(tasks.engagementId, engagementId))).toHaveLength(10);
    expect(await h.db.select().from(workflowInstances).where(and(eq(workflowInstances.engagementId, engagementId)))).toHaveLength(1);

    // Dependencies came across: "Verify client information" waits for "Request tax documents".
    const verify = generated.find((t) => t.sequence === 2)!;
    await expect(setTaskStatus(h.db, manager, verify.id, "in_progress")).rejects.toThrow(/Request tax documents/);
  });
});

describe("Scenario 6 — task management", () => {
  let engagementId: string;
  let taskId: string;
  beforeAll(async () => {
    engagementId = (await createEngagement(h.db, manager, clientId, { title: "Bookkeeping Feb", serviceType: "bookkeeping", ownerId: manager.userId })).id;
    taskId = (await createTask(h.db, manager, { title: "Reconcile accounts", priority: "high", dueDate: "2027-02-10", estimatedMinutes: "2.5" }, { engagementId })).id;
  });

  it("assigns, starts, completes; every change persists with history", async () => {
    await assignTask(h.db, manager, taskId, employee.userId);
    await setTaskStatus(h.db, employee, taskId, "in_progress");
    await setTaskStatus(h.db, employee, taskId, "completed");
    const d = await getTask(h.db, employee, taskId);
    expect(d.task).toMatchObject({ assigneeId: employee.userId, assignedById: manager.userId, status: "completed", estimatedMinutes: 150 });
    expect(d.task.completedAt).not.toBeNull();
    expect(d.task.startDate).not.toBeNull();
    expect(d.history.map((x) => x.newStatus)).toEqual(["todo", "in_progress", "completed"]);
    expect(d.clientName).toBe("John Smith");
    expect(d.engagementTitle).toBe("Bookkeeping Feb");
  });

  it("finishing every task flags the engagement ready for review but never closes it", async () => {
    const e = await getEngagement(h.db, manager, engagementId);
    expect(e.progress).toMatchObject({ total: 1, completed: 1, percent: 100, readyForReview: true });
    expect(e.engagement.status).toBe("active");
    expect((await listEntityTimeline(h.db, manager, "engagement", engagementId)).some((t) => t.body?.includes("ready for review"))).toBe(true);
    // Only managers/admins complete or close; closing needs completion first.
    await expect(setEngagementStatus(h.db, employee, engagementId, "completed")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setEngagementStatus(h.db, manager, engagementId, "closed")).rejects.toBeInstanceOf(ValidationError);
    await setEngagementStatus(h.db, employee, engagementId, "in_review");
    await setEngagementStatus(h.db, manager, engagementId, "completed");
    await setEngagementStatus(h.db, manager, engagementId, "closed");
    const closed = (await getEngagement(h.db, manager, engagementId)).engagement;
    expect(closed.closedAt).not.toBeNull();
    await expect(setEngagementStatus(h.db, admin, engagementId, "in_progress")).rejects.toBeInstanceOf(ValidationError);
  });

  it("comments, internal notes and checklists", async () => {
    const t = await createTask(h.db, employee, { title: "Prep workpapers", clientId }, {});
    await addTaskComment(h.db, employee, t.id, "comment", "Started on this");
    await addTaskComment(h.db, employee, t.id, "internal_note", "Client is slow to respond");
    await addChecklistItem(h.db, employee, t.id, "Bank statements");
    await addChecklistItem(h.db, employee, t.id, "Credit cards");
    const d = await getTask(h.db, employee, t.id);
    await setChecklistItemDone(h.db, employee, t.id, d.checklist[0]!.id, true);
    const again = await getTask(h.db, employee, t.id);
    expect(again.checklist.map((c) => [c.title, c.done])).toEqual([
      ["Bank statements", true],
      ["Credit cards", false],
    ]);
    expect(again.timeline.filter((x) => x.type === "comment" || x.type === "internal_note")).toHaveLength(2);
    expect(again.task.engagementId).toBeNull();
    expect(again.task.clientId).toBe(clientId);
  });

  it("employees can't reassign others' tasks; read-only can't change tasks; filters work", async () => {
    const t = await createTask(h.db, manager, { title: "Assigned to Earl", assigneeId: employee2.userId, dueDate: "2020-01-01" }, { engagementId: (await createEngagement(h.db, manager, clientId, { title: "Misc", serviceType: "other", ownerId: manager.userId })).id });
    await expect(assignTask(h.db, employee, t.id, employee.userId)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(updateTask(h.db, readOnly, t.id, { title: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setTaskStatus(h.db, readOnly, t.id, "completed")).rejects.toBeInstanceOf(ForbiddenError);
    expect((await listTasks(h.db, manager, { due: "overdue", today: "2026-11-12" })).map((x) => x.id)).toContain(t.id);
    expect((await listTasks(h.db, employee2, { mine: true })).map((x) => x.id)).toContain(t.id);
    expect((await listTasks(h.db, manager, { status: "done" })).every((x) => x.status === "completed" || x.status === "cancelled")).toBe(true);
  });

  it("rejects circular dependencies", async () => {
    const e = await createEngagement(h.db, manager, clientId, { title: "Deps", serviceType: "other", ownerId: manager.userId });
    const a = await createTask(h.db, manager, { title: "A" }, { engagementId: e.id });
    const b = await createTask(h.db, manager, { title: "B", dependsOn: [a.id] }, { engagementId: e.id });
    await expect(updateTask(h.db, manager, a.id, { title: "A", dependsOn: [b.id] })).rejects.toBeInstanceOf(ValidationError);
  });
});
