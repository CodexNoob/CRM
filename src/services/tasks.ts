import { and, asc, desc, eq, ilike, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "@/db";
import { clients, documents, engagements, taskChecklistItems, taskDependencies, tasks, users, type Task, type TaskStatus } from "@/db/schema";
import { isManagerOrAdmin, seesAllClients, type Actor } from "@/lib/auth/actor";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { TASK_CLOSED, TASK_OPEN } from "@/lib/status";
import { isUuid, parseInput, taskInputSchema } from "@/lib/validation";
import { recordAudit } from "./audit";
import { assertActiveStaffUser, assertClientAccess, ensureAssignment, inFirm, requireCanAssign, requirePermission, requireStaff, visibleClientsCondition } from "./access";
import { uploadDocument } from "./documents";
import { computeProgress, loadEngagementForStaff, workAllowed } from "./engagements";
import { listEntityTimeline, listStatusHistory, logActivity, nextNumber, recordStatusChange, type StatusHistoryItem, type TimelineItem } from "./timeline";

/**
 * Tasks: the actual work. A task belongs to an engagement (and its client), to a client only
 * (e.g. onboarding), or to neither (internal). Statuses: todo → in_progress → waiting_client /
 * waiting_review / blocked → completed (or cancelled). A task with unfinished dependencies
 * can't start or complete. Tasks on engagements whose proposal isn't accepted can't start.
 */

const assignee = alias(users, "assignee");
const assigner = alias(users, "assigner");

export interface TaskRow {
  id: string;
  taskNumber: number | null;
  title: string;
  status: TaskStatus;
  priority: Task["priority"];
  isClientTask: boolean;
  startDate: string | null;
  dueDate: string | null;
  completedAt: Date | null;
  assigneeId: string | null;
  assigneeName: string | null;
  engagementId: string | null;
  engagementTitle: string | null;
  clientId: string | null;
  clientName: string | null;
  parentTaskId: string | null;
  workflowInstanceId: string | null;
  createdAt: Date;
}

export interface TaskFilters {
  /** true = client requests only, false = internal tasks only. */
  isClientTask?: boolean;
  mine?: boolean;
  /** "open" = not finished (default), "done" = completed/cancelled, "all", or one status. */
  status?: "open" | "done" | "all" | TaskStatus;
  clientId?: string;
  engagementId?: string;
  assigneeId?: string | "none";
  priority?: Task["priority"];
  due?: "overdue" | "today" | "week" | "none";
  today?: string;
  q?: string;
}

/**
 * Which tasks a staff member may see: tasks of clients they can access, plus internal tasks
 * (no client) that are theirs — or all internal tasks for admins/managers/read-only.
 */
function visibleTasks(db: Db, actor: Actor) {
  const visible = visibleClientsCondition(db, actor);
  return or(
    and(sql`${tasks.clientId} is not null`, sql`exists (select 1 from ${clients} where ${clients.id} = ${tasks.clientId} and ${visible})`),
    and(isNull(tasks.clientId), seesAllClients(actor) ? undefined : or(eq(tasks.assigneeId, actor.userId), eq(tasks.assignedById, actor.userId))),
  );
}

function rowSelect() {
  return {
    id: tasks.id,
    taskNumber: tasks.taskNumber,
    title: tasks.title,
    status: tasks.status,
    priority: tasks.priority,
    isClientTask: tasks.isClientTask,
    startDate: tasks.startDate,
    dueDate: tasks.dueDate,
    completedAt: tasks.completedAt,
    assigneeId: tasks.assigneeId,
    assigneeName: assignee.name,
    engagementId: tasks.engagementId,
    engagementTitle: engagements.title,
    clientId: tasks.clientId,
    clientName: clients.displayName,
    parentTaskId: tasks.parentTaskId,
    workflowInstanceId: tasks.workflowInstanceId,
    createdAt: tasks.createdAt,
  };
}

export async function listTasks(db: Db, actor: Actor, f: TaskFilters = {}): Promise<TaskRow[]> {
  requireStaff(actor);
  const today = f.today ?? new Date().toISOString().slice(0, 10);
  const week = new Date(Date.parse(`${today}T00:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);
  const q = f.q?.trim().slice(0, 100);
  const like = q ? `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : undefined;
  const status = f.status ?? "open";
  return db
    .select(rowSelect())
    .from(tasks)
    .leftJoin(engagements, and(eq(engagements.id, tasks.engagementId), eq(engagements.firmId, tasks.firmId)))
    .leftJoin(clients, and(eq(clients.id, tasks.clientId), eq(clients.firmId, tasks.firmId)))
    .leftJoin(assignee, eq(assignee.id, tasks.assigneeId))
    .where(
      and(
        inFirm(tasks.firmId, actor),
        isNull(tasks.archivedAt),
        visibleTasks(db, actor),
        status === "open" ? inArray(tasks.status, [...TASK_OPEN]) : status === "done" ? inArray(tasks.status, [...TASK_CLOSED]) : status === "all" ? undefined : eq(tasks.status, status),
        f.mine ? eq(tasks.assigneeId, actor.userId) : undefined,
        f.assigneeId === "none" ? isNull(tasks.assigneeId) : f.assigneeId && isUuid(f.assigneeId) ? eq(tasks.assigneeId, f.assigneeId) : undefined,
        f.clientId && isUuid(f.clientId) ? eq(tasks.clientId, f.clientId) : undefined,
        f.engagementId && isUuid(f.engagementId) ? eq(tasks.engagementId, f.engagementId) : undefined,
        f.priority ? eq(tasks.priority, f.priority) : undefined,
        f.isClientTask === undefined ? undefined : eq(tasks.isClientTask, f.isClientTask),
        f.due === "overdue" ? and(inArray(tasks.status, [...TASK_OPEN]), lt(tasks.dueDate, today)) : undefined,
        f.due === "today" ? eq(tasks.dueDate, today) : undefined,
        f.due === "week" ? and(sql`${tasks.dueDate} >= ${today}`, lte(tasks.dueDate, week)) : undefined,
        f.due === "none" ? isNull(tasks.dueDate) : undefined,
        like ? or(ilike(tasks.title, like), ilike(clients.displayName, like), ilike(engagements.title, like)) : undefined,
      ),
    )
    .orderBy(sql`${tasks.dueDate} asc nulls last`, sql`${tasks.sequence} asc nulls last`, desc(tasks.createdAt))
    .limit(1000);
}

export async function countMyOpenTasks(db: Db, actor: Actor): Promise<number> {
  requireStaff(actor);
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(tasks)
    .where(and(inFirm(tasks.firmId, actor), isNull(tasks.archivedAt), visibleTasks(db, actor), eq(tasks.assigneeId, actor.userId), inArray(tasks.status, [...TASK_OPEN])));
  return row?.n ?? 0;
}

/** Loads a task the actor may see (staff), or a client-facing task of the actor's own client (portal). */
async function loadTask(db: Db, actor: Actor, taskId: string): Promise<Task> {
  if (!isUuid(taskId)) throw new NotFoundError();
  const [task] = await db.select().from(tasks).where(and(eq(tasks.id, taskId), inFirm(tasks.firmId, actor), isNull(tasks.archivedAt))).limit(1);
  if (!task) throw new NotFoundError();
  if (actor.role === "client") {
    if (!actor.clientId || task.clientId !== actor.clientId || !task.isClientTask) throw new NotFoundError();
    return task;
  }
  if (task.clientId) await assertClientAccess(db, actor, task.clientId);
  else if (!seesAllClients(actor) && task.assigneeId !== actor.userId && task.assignedById !== actor.userId) throw new NotFoundError();
  return task;
}

export interface TaskDetail {
  task: Task;
  clientName: string | null;
  engagementTitle: string | null;
  assigneeName: string | null;
  assignedByName: string | null;
  parent: { id: string; title: string } | null;
  subtasks: TaskRow[];
  dependencies: { id: string; title: string; status: TaskStatus; taskNumber: number | null }[];
  blockedBy: { id: string; title: string }[];
  checklist: (typeof taskChecklistItems.$inferSelect)[];
  attachments: { id: string; fileName: string; sizeBytes: number; createdAt: Date }[];
  timeline: TimelineItem[];
  history: StatusHistoryItem[];
}

export async function getTask(db: Db, actor: Actor, taskId: string): Promise<TaskDetail> {
  requireStaff(actor);
  const task = await loadTask(db, actor, taskId);
  const [names] = await db
    .select({ clientName: clients.displayName, engagementTitle: engagements.title, assigneeName: assignee.name, assignedByName: assigner.name })
    .from(tasks)
    .leftJoin(clients, and(eq(clients.id, tasks.clientId), eq(clients.firmId, tasks.firmId)))
    .leftJoin(engagements, and(eq(engagements.id, tasks.engagementId), eq(engagements.firmId, tasks.firmId)))
    .leftJoin(assignee, eq(assignee.id, tasks.assigneeId))
    .leftJoin(assigner, eq(assigner.id, tasks.assignedById))
    .where(and(eq(tasks.id, task.id), inFirm(tasks.firmId, actor)));
  const parent = task.parentTaskId ? ((await db.select({ id: tasks.id, title: tasks.title }).from(tasks).where(and(eq(tasks.id, task.parentTaskId), inFirm(tasks.firmId, actor))))[0] ?? null) : null;
  const subtasks = await db
    .select(rowSelect())
    .from(tasks)
    .leftJoin(engagements, and(eq(engagements.id, tasks.engagementId), eq(engagements.firmId, tasks.firmId)))
    .leftJoin(clients, and(eq(clients.id, tasks.clientId), eq(clients.firmId, tasks.firmId)))
    .leftJoin(assignee, eq(assignee.id, tasks.assigneeId))
    .where(and(eq(tasks.parentTaskId, task.id), inFirm(tasks.firmId, actor), isNull(tasks.archivedAt)))
    .orderBy(asc(tasks.createdAt));
  const dependencies = await dependencyRows(db, actor, task.id);
  return {
    task,
    clientName: names?.clientName ?? null,
    engagementTitle: names?.engagementTitle ?? null,
    assigneeName: names?.assigneeName ?? null,
    assignedByName: names?.assignedByName ?? null,
    parent,
    subtasks,
    dependencies,
    blockedBy: dependencies.filter((d) => d.status !== "completed" && d.status !== "cancelled"),
    checklist: await db
      .select()
      .from(taskChecklistItems)
      .where(and(eq(taskChecklistItems.taskId, task.id), inFirm(taskChecklistItems.firmId, actor)))
      .orderBy(asc(taskChecklistItems.sequence), asc(taskChecklistItems.createdAt)),
    attachments: await db
      .select({ id: documents.id, fileName: documents.fileName, sizeBytes: documents.sizeBytes, createdAt: documents.createdAt })
      .from(documents)
      .where(and(eq(documents.taskId, task.id), inFirm(documents.firmId, actor), isNull(documents.deletedAt)))
      .orderBy(desc(documents.createdAt)),
    timeline: await listEntityTimeline(db, actor, "task", task.id),
    history: await listStatusHistory(db, actor, "task", task.id),
  };
}

async function dependencyRows(db: Db, actor: Actor, taskId: string) {
  const dep = alias(tasks, "dep");
  return db
    .select({ id: dep.id, title: dep.title, status: dep.status, taskNumber: dep.taskNumber })
    .from(taskDependencies)
    .innerJoin(dep, eq(dep.id, taskDependencies.dependsOnTaskId))
    .where(and(eq(taskDependencies.taskId, taskId), inFirm(taskDependencies.firmId, actor)));
}

/* ───────── Create / update ───────── */

/** Creates a task. With `engagementId` it belongs to that engagement and its client. */
export async function createTask(db: Db, actor: Actor, input: unknown, opts: { engagementId?: string } = {}): Promise<Task> {
  requirePermission(actor, "tasks", "create");
  const data = parseInput(taskInputSchema, input);
  let clientId: string | null = null;
  let engagementId: string | null = null;
  if (opts.engagementId) {
    const e = await loadEngagementForStaff(db, actor, opts.engagementId);
    if (e.status === "closed") throw new ValidationError({ _form: ["Closed engagements can’t get new tasks."] });
    engagementId = e.id;
    clientId = e.clientId;
  } else if (data.clientId) {
    await assertClientAccess(db, actor, data.clientId);
    clientId = data.clientId;
  }
  if (data.isClientTask && !clientId) throw new ValidationError({ isClientTask: ["Client requests need a client."] });
  if (data.isClientTask) data.assigneeId = undefined; // client tasks belong to the client
  if (data.assigneeId) {
    requireCanAssign(actor, data.assigneeId);
    await assertActiveStaffUser(db, actor, data.assigneeId, "assigneeId");
  }
  if (data.parentTaskId) {
    const parent = await loadTask(db, actor, data.parentTaskId);
    if (parent.engagementId !== engagementId || parent.clientId !== clientId) throw new ValidationError({ parentTaskId: ["A subtask must belong to the same engagement as its parent."] });
  }

  return db.transaction(async (txRaw) => {
    const t = txRaw as unknown as Db;
    const [task] = await t
      .insert(tasks)
      .values({
        firmId: actor.firmId,
        taskNumber: await nextNumber(t, actor.firmId, "task"),
        engagementId,
        clientId,
        title: data.title,
        description: data.description ?? null,
        isClientTask: data.isClientTask,
        assigneeId: data.assigneeId ?? null,
        assignedById: data.assigneeId ? actor.userId : null,
        priority: data.priority,
        startDate: data.startDate ?? null,
        dueDate: data.dueDate ?? null,
        estimatedMinutes: data.estimatedMinutes ?? null,
        parentTaskId: data.parentTaskId ?? null,
      })
      .returning();
    if (!task) throw new Error("Insert returned no row");
    if (data.dependsOn.length) await writeDependencies(t, actor, task, data.dependsOn);
    if (data.assigneeId && clientId) await ensureAssignment(t, actor.firmId, clientId, data.assigneeId);
    await recordAudit(t, { firmId: actor.firmId, actorUserId: actor.userId, action: "task.create", entityType: "task", entityId: task.id, metadata: { engagementId, clientId, isClientTask: data.isClientTask } });
    await logActivity(t, actor, { entityType: "task", entityId: task.id, clientId, type: "system", body: "Task created" });
    await recordStatusChange(t, actor, { entityType: "task", entityId: task.id, clientId, from: null, to: "todo" });
    if (data.assigneeId) await logAssignment(t, actor, task, data.assigneeId);
    return task;
  });
}

/** Back-compat: tasks created from an engagement page. */
export async function createEngagementTask(db: Db, actor: Actor, engagementId: string, input: unknown): Promise<Task> {
  return createTask(db, actor, input, { engagementId });
}

async function logAssignment(db: Db, actor: Actor, task: Pick<Task, "id" | "clientId" | "engagementId" | "title">, userId: string) {
  await logActivity(db, actor, { entityType: "task", entityId: task.id, clientId: task.clientId, type: "assignment", metadata: { userId, title: task.title, engagementId: task.engagementId } });
  await recordAudit(db, { firmId: actor.firmId, actorUserId: actor.userId, action: "task.assign", entityType: "task", entityId: task.id, metadata: { userId, engagementId: task.engagementId } });
}

/** Employees may only (re)assign their own or unassigned tasks; managers/admins anything. */
function assertMayReassign(actor: Actor, current: string | null) {
  if (current && current !== actor.userId && !isManagerOrAdmin(actor)) throw new ForbiddenError("Only an admin or manager can reassign someone else’s task.");
}

export async function updateTask(db: Db, actor: Actor, taskId: string, input: unknown): Promise<Task> {
  requirePermission(actor, "tasks", "edit");
  const existing = await loadTask(db, actor, taskId);
  const data = parseInput(taskInputSchema, input);
  const nextAssignee = existing.isClientTask ? null : (data.assigneeId ?? null);
  if (nextAssignee !== existing.assigneeId) {
    assertMayReassign(actor, existing.assigneeId);
    if (nextAssignee) {
      requireCanAssign(actor, nextAssignee);
      await assertActiveStaffUser(db, actor, nextAssignee, "assigneeId");
    }
  }
  const next = {
    title: data.title,
    description: data.description ?? null,
    assigneeId: nextAssignee,
    priority: data.priority,
    startDate: data.startDate ?? null,
    dueDate: data.dueDate ?? null,
    estimatedMinutes: data.estimatedMinutes ?? null,
    actualMinutes: data.actualMinutes ?? null,
  };
  const changed = (Object.keys(next) as (keyof typeof next)[]).filter((k) => next[k] !== existing[k]);
  const currentDeps = (await dependencyRows(db, actor, taskId)).map((d) => d.id).sort();
  const depsChanged = JSON.stringify(currentDeps) !== JSON.stringify([...new Set(data.dependsOn)].sort());
  if (!changed.length && !depsChanged) return existing;
  return db.transaction(async (txRaw) => {
    const t = txRaw as unknown as Db;
    const [row] = await t
      .update(tasks)
      .set({ ...next, ...(changed.includes("assigneeId") ? { assignedById: next.assigneeId ? actor.userId : null } : {}), updatedAt: new Date() })
      .where(and(eq(tasks.id, taskId), inFirm(tasks.firmId, actor)))
      .returning();
    if (!row) throw new NotFoundError();
    if (depsChanged) await writeDependencies(t, actor, row, data.dependsOn, { replace: true });
    if (changed.includes("assigneeId") && next.assigneeId) {
      if (row.clientId) await ensureAssignment(t, actor.firmId, row.clientId, next.assigneeId);
      await logAssignment(t, actor, row, next.assigneeId);
    }
    const other = [...changed.filter((c) => c !== "assigneeId"), ...(depsChanged ? ["dependencies"] : [])];
    if (other.length) {
      await logActivity(t, actor, { entityType: "task", entityId: taskId, clientId: row.clientId, type: "system", body: "Task details updated", metadata: { changedFields: other } });
      await recordAudit(t, { firmId: actor.firmId, actorUserId: actor.userId, action: "task.update", entityType: "task", entityId: taskId, metadata: { changedFields: other } });
    }
    return row;
  });
}

/** Assign / reassign / unassign one task (kanban, row menu). */
export async function assignTask(db: Db, actor: Actor, taskId: string, assigneeId: string | null): Promise<void> {
  requirePermission(actor, "tasks", "edit");
  const task = await loadTask(db, actor, taskId);
  if (task.isClientTask) throw new ValidationError({ assigneeId: ["Client requests aren’t assigned to staff."] });
  if (task.assigneeId === assigneeId) return;
  assertMayReassign(actor, task.assigneeId);
  if (assigneeId) {
    requireCanAssign(actor, assigneeId);
    await assertActiveStaffUser(db, actor, assigneeId, "assigneeId");
  }
  await db.transaction(async (txRaw) => {
    const t = txRaw as unknown as Db;
    await t.update(tasks).set({ assigneeId, assignedById: assigneeId ? actor.userId : null, updatedAt: new Date() }).where(and(eq(tasks.id, taskId), inFirm(tasks.firmId, actor)));
    if (assigneeId) {
      if (task.clientId) await ensureAssignment(t, actor.firmId, task.clientId, assigneeId);
      await logAssignment(t, actor, task, assigneeId);
    } else {
      await logActivity(t, actor, { entityType: "task", entityId: taskId, clientId: task.clientId, type: "system", body: "Task unassigned" });
    }
  });
}

/* ───────── Dependencies ───────── */

/** Writes dependencies: same engagement (or client) only, no self-reference, no cycles. */
async function writeDependencies(db: Db, actor: Actor, task: Task, dependsOn: string[], opts: { replace?: boolean } = {}) {
  const ids = [...new Set(dependsOn)].filter((id) => id !== task.id);
  if (ids.length) {
    const found = await db
      .select({ id: tasks.id, engagementId: tasks.engagementId, clientId: tasks.clientId })
      .from(tasks)
      .where(and(inArray(tasks.id, ids), inFirm(tasks.firmId, actor)));
    if (found.length !== ids.length || found.some((f) => f.engagementId !== task.engagementId || f.clientId !== task.clientId)) {
      throw new ValidationError({ dependsOn: ["Dependencies must be tasks of the same engagement."] });
    }
    // Cycle check: none of the new prerequisites may (transitively) depend on this task.
    const all = await db.select({ taskId: taskDependencies.taskId, dependsOn: taskDependencies.dependsOnTaskId }).from(taskDependencies).where(inFirm(taskDependencies.firmId, actor));
    const edges = new Map<string, string[]>();
    for (const e of all) if (e.taskId !== task.id || !opts.replace) edges.set(e.taskId, [...(edges.get(e.taskId) ?? []), e.dependsOn]);
    const reaches = (from: string, target: string, seen = new Set<string>()): boolean => {
      if (from === target) return true;
      if (seen.has(from)) return false;
      seen.add(from);
      return (edges.get(from) ?? []).some((n) => reaches(n, target, seen));
    };
    if (ids.some((id) => reaches(id, task.id))) throw new ValidationError({ dependsOn: ["That would create a circular dependency."] });
  }
  if (opts.replace) await db.delete(taskDependencies).where(and(eq(taskDependencies.taskId, task.id), inFirm(taskDependencies.firmId, actor)));
  if (ids.length) await db.insert(taskDependencies).values(ids.map((d) => ({ firmId: actor.firmId, taskId: task.id, dependsOnTaskId: d }))).onConflictDoNothing();
}

/* ───────── Status ───────── */

const STARTED: TaskStatus[] = ["in_progress", "waiting_review", "completed"];

/**
 * Changes a task's status, recording history.
 *  - Staff: any visible task (read-only users can't). Clients: only their client-facing tasks, only to completed.
 *  - Can't start or complete while a dependency is unfinished.
 *  - Can't start work on an engagement whose proposal isn't accepted (unless a manager overrode).
 *  - Completing the last open task flags the engagement "ready for review" (it never closes it).
 */
export async function setTaskStatus(db: Db, actor: Actor, taskId: string, requested: TaskStatus | "open" | "done", note?: string): Promise<Task> {
  const status: TaskStatus = requested === "open" ? "todo" : requested === "done" ? "completed" : requested;
  if (!tasks.status.enumValues.includes(status)) throw new ValidationError({ status: ["Choose a status."] });
  if (actor.role !== "client") requirePermission(actor, "tasks", "edit");
  const task = await loadTask(db, actor, taskId);
  if (actor.role === "client" && status !== "completed") throw new NotFoundError();
  if (task.status === status) return task;

  if (STARTED.includes(status)) {
    const blockers = (await dependencyRows(db, actor, taskId)).filter((d) => d.status !== "completed" && d.status !== "cancelled");
    if (blockers.length) {
      const names = blockers.map((b) => b.title).join(", ");
      throw new ValidationError({ status: [`Waiting on: ${names}.`] }, `This task is waiting on: ${names}.`);
    }
    if (task.engagementId && actor.role !== "client") {
      const e = await loadEngagementForStaff(db, actor, task.engagementId);
      if (e.status === "closed") throw new ValidationError({ status: ["This engagement is closed."] });
      if (!workAllowed(e)) throw new ValidationError({ status: ["Work can’t start until the engagement’s proposal is accepted (or a manager allows it)."] });
    }
  }

  const now = new Date();
  return db.transaction(async (txRaw) => {
    const t = txRaw as unknown as Db;
    const [row] = await t
      .update(tasks)
      .set({
        status,
        completedAt: status === "completed" ? now : null,
        completedById: status === "completed" ? actor.userId : null,
        ...(status === "in_progress" && !task.startDate ? { startDate: now.toISOString().slice(0, 10) } : {}),
        updatedAt: now,
      })
      .where(and(eq(tasks.id, taskId), inFirm(tasks.firmId, actor)))
      .returning();
    if (!row) throw new NotFoundError();
    await recordStatusChange(t, actor, { entityType: "task", entityId: taskId, clientId: task.clientId, from: task.status, to: status, note });
    await recordAudit(t, {
      firmId: actor.firmId,
      actorUserId: actor.userId,
      action: status === "completed" ? "task.complete" : task.status === "completed" ? "task.reopen" : "task.status",
      entityType: "task",
      entityId: taskId,
    });
    if (task.engagementId && status === "completed") await flagReadyForReview(t, actor, task.engagementId);
    return row;
  });
}

/** Records (on the timeline + the manager's notifications) that every task of the engagement is done. */
async function flagReadyForReview(db: Db, actor: Actor, engagementId: string) {
  const list = await db.select({ status: tasks.status, dueDate: tasks.dueDate }).from(tasks).where(and(eq(tasks.engagementId, engagementId), inFirm(tasks.firmId, actor), isNull(tasks.archivedAt)));
  if (!computeProgress(list).readyForReview) return;
  const [e] = await db
    .select({ ownerId: engagements.ownerId, clientId: engagements.clientId, title: engagements.title, status: engagements.status })
    .from(engagements)
    .where(and(eq(engagements.id, engagementId), inFirm(engagements.firmId, actor)));
  if (!e || ["in_review", "completed", "filed", "closed", "cancelled"].includes(e.status)) return;
  await logActivity(db, actor, {
    entityType: "engagement",
    entityId: engagementId,
    clientId: e.clientId,
    type: "system",
    body: "All tasks are completed — ready for review",
    metadata: { kind: "ready_for_review", notifyUserId: e.ownerId, title: e.title },
  });
}

/* ───────── Comments, checklist, attachments ───────── */

export async function addTaskComment(db: Db, actor: Actor, taskId: string, kind: "comment" | "internal_note", body: string): Promise<void> {
  requirePermission(actor, "tasks", "edit");
  const task = await loadTask(db, actor, taskId);
  const text = body.trim();
  if (!text) throw new ValidationError({ body: ["Write something first."] });
  if (text.length > 5000) throw new ValidationError({ body: ["Keep it under 5,000 characters."] });
  await logActivity(db, actor, { entityType: "task", entityId: taskId, clientId: task.clientId, type: kind === "internal_note" ? "internal_note" : "comment", body: text });
}

export async function addChecklistItem(db: Db, actor: Actor, taskId: string, title: string): Promise<void> {
  requirePermission(actor, "tasks", "edit");
  await loadTask(db, actor, taskId);
  const text = title.trim().slice(0, 300);
  if (!text) throw new ValidationError({ title: ["Describe the step."] });
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(taskChecklistItems).where(and(eq(taskChecklistItems.taskId, taskId), inFirm(taskChecklistItems.firmId, actor)));
  await db.insert(taskChecklistItems).values({ firmId: actor.firmId, taskId, title: text, sequence: row?.n ?? 0 });
}

export async function setChecklistItemDone(db: Db, actor: Actor, taskId: string, itemId: string, done: boolean): Promise<void> {
  requirePermission(actor, "tasks", "edit");
  await loadTask(db, actor, taskId);
  if (!isUuid(itemId)) throw new NotFoundError();
  const [row] = await db
    .update(taskChecklistItems)
    .set({ done, doneById: done ? actor.userId : null, doneAt: done ? new Date() : null })
    .where(and(eq(taskChecklistItems.id, itemId), eq(taskChecklistItems.taskId, taskId), inFirm(taskChecklistItems.firmId, actor)))
    .returning({ id: taskChecklistItems.id });
  if (!row) throw new NotFoundError();
}

export async function removeChecklistItem(db: Db, actor: Actor, taskId: string, itemId: string): Promise<void> {
  requirePermission(actor, "tasks", "edit");
  await loadTask(db, actor, taskId);
  if (!isUuid(itemId)) throw new NotFoundError();
  await db.delete(taskChecklistItems).where(and(eq(taskChecklistItems.id, itemId), eq(taskChecklistItems.taskId, taskId), inFirm(taskChecklistItems.firmId, actor)));
}

/** Attaches a file to a task (stored as a client document linked to the task). */
export async function attachTaskFile(db: Db, actor: Actor, taskId: string, file: { fileName: string; data: Buffer }): Promise<void> {
  requirePermission(actor, "tasks", "edit");
  const task = await loadTask(db, actor, taskId);
  if (!task.clientId) throw new ValidationError({ file: ["Attachments need a task that belongs to a client."] });
  const doc = await uploadDocument(db, actor, { clientId: task.clientId, engagementId: task.engagementId ?? undefined, taskId: task.id, ...file });
  await logActivity(db, actor, { entityType: "task", entityId: taskId, clientId: task.clientId, type: "system", body: `Attached ${doc.fileName}` });
}

/** Archives a task (never hard-deleted). */
export async function archiveTask(db: Db, actor: Actor, taskId: string): Promise<void> {
  requirePermission(actor, "tasks", "delete");
  const task = await loadTask(db, actor, taskId);
  await db.update(tasks).set({ archivedAt: new Date(), updatedAt: new Date() }).where(and(eq(tasks.id, taskId), inFirm(tasks.firmId, actor)));
  await logActivity(db, actor, { entityType: "task", entityId: taskId, clientId: task.clientId, type: "system", body: "Task archived" });
}
