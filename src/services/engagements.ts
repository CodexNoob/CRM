import { and, asc, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "@/db";
import { clients, engagements, tasks, users, type Engagement, type EngagementStatus, type Task } from "@/db/schema";
import type { Actor } from "@/lib/auth/actor";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { engagementInputSchema, isUuid, parseInput, taskInputSchema } from "@/lib/validation";
import { recordAudit } from "./audit";
import { assertActiveStaffUser, assertClientAccess, ensureAssignment, requireCanAssign, requireStaff, visibleClientsCondition } from "./access";

const CLOSED_STATUSES: EngagementStatus[] = ["completed"];

export interface EngagementSummary {
  id: string;
  title: string;
  status: EngagementStatus;
  serviceType: Engagement["serviceType"];
  taxYear: number | null;
  dueDate: string | null;
  clientId: string;
  clientName: string;
  ownerName: string;
  openTaskCount: number;
}

const owner = alias(users, "owner");

function summarySelect() {
  return {
    id: engagements.id,
    title: engagements.title,
    status: engagements.status,
    serviceType: engagements.serviceType,
    taxYear: engagements.taxYear,
    dueDate: engagements.dueDate,
    clientId: engagements.clientId,
    clientName: clients.displayName,
    ownerName: owner.name,
    openTaskCount: sql<number>`(select count(*)::int from ${tasks} where ${tasks.engagementId} = ${engagements.id} and ${tasks.status} = 'open')`,
  };
}

/** Open engagements the actor can see, soonest due first (dashboard). */
export async function listOpenEngagements(
  db: Db,
  actor: Actor,
  opts: { ownedByMe?: boolean } = {},
): Promise<EngagementSummary[]> {
  const visible = visibleClientsCondition(db, actor);
  return db
    .select(summarySelect())
    .from(engagements)
    .innerJoin(clients, eq(clients.id, engagements.clientId))
    .innerJoin(owner, eq(owner.id, engagements.ownerId))
    .where(
      and(
        visible,
        notInArray(engagements.status, CLOSED_STATUSES),
        opts.ownedByMe ? eq(engagements.ownerId, actor.userId) : undefined,
      ),
    )
    .orderBy(sql`${engagements.dueDate} asc nulls last`, asc(clients.displayName))
    .limit(200);
}

export async function listClientEngagements(db: Db, actor: Actor, clientId: string): Promise<EngagementSummary[]> {
  await assertClientAccess(db, actor, clientId);
  return db
    .select(summarySelect())
    .from(engagements)
    .innerJoin(clients, eq(clients.id, engagements.clientId))
    .innerJoin(owner, eq(owner.id, engagements.ownerId))
    .where(eq(engagements.clientId, clientId))
    .orderBy(desc(engagements.createdAt));
}

export interface EngagementDetail {
  engagement: Engagement;
  clientName: string;
  ownerName: string;
  tasks: (Task & { assigneeName: string | null })[];
}

async function loadEngagementForStaff(db: Db, actor: Actor, engagementId: string): Promise<Engagement> {
  requireStaff(actor);
  if (!isUuid(engagementId)) throw new NotFoundError();
  const [engagement] = await db.select().from(engagements).where(eq(engagements.id, engagementId)).limit(1);
  if (!engagement) throw new NotFoundError();
  await assertClientAccess(db, actor, engagement.clientId);
  return engagement;
}

export async function getEngagement(db: Db, actor: Actor, engagementId: string): Promise<EngagementDetail> {
  const engagement = await loadEngagementForStaff(db, actor, engagementId);
  const [names] = await db
    .select({ clientName: clients.displayName, ownerName: owner.name })
    .from(clients)
    .innerJoin(owner, eq(owner.id, engagement.ownerId))
    .where(eq(clients.id, engagement.clientId));
  const assignee = alias(users, "assignee");
  const taskRows = await db
    .select({ task: tasks, assigneeName: assignee.name })
    .from(tasks)
    .leftJoin(assignee, eq(assignee.id, tasks.assigneeId))
    .where(eq(tasks.engagementId, engagement.id))
    .orderBy(asc(tasks.status), sql`${tasks.dueDate} asc nulls last`, asc(tasks.createdAt));
  return {
    engagement,
    clientName: names?.clientName ?? "",
    ownerName: names?.ownerName ?? "",
    tasks: taskRows.map((r) => ({ ...r.task, assigneeName: r.assigneeName })),
  };
}

export async function createEngagement(db: Db, actor: Actor, clientId: string, input: unknown): Promise<Engagement> {
  await assertClientAccess(db, actor, clientId);
  const data = parseInput(engagementInputSchema, input);
  requireCanAssign(actor, data.ownerId);
  await assertActiveStaffUser(db, data.ownerId, "ownerId");
  return db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const [engagement] = await t
      .insert(engagements)
      .values({ ...data, taxYear: data.taxYear ?? null, dueDate: data.dueDate ?? null, clientId })
      .returning();
    if (!engagement) throw new Error("Insert returned no row");
    // The owner must be able to see the client they are responsible for.
    await ensureAssignment(t, clientId, data.ownerId);
    await recordAudit(t, {
      actorUserId: actor.userId,
      action: "engagement.create",
      entityType: "engagement",
      entityId: engagement.id,
      metadata: { clientId },
    });
    await recordAudit(t, {
      actorUserId: actor.userId,
      action: "client.assign",
      entityType: "client",
      entityId: clientId,
      metadata: { userId: data.ownerId, reason: "engagement_owner" },
    });
    return engagement;
  });
}

export async function updateEngagement(db: Db, actor: Actor, engagementId: string, input: unknown): Promise<Engagement> {
  const existing = await loadEngagementForStaff(db, actor, engagementId);
  const data = parseInput(engagementInputSchema, input);
  if (data.ownerId !== existing.ownerId) {
    requireCanAssign(actor, data.ownerId);
    await assertActiveStaffUser(db, data.ownerId, "ownerId");
  }
  const next = { ...data, taxYear: data.taxYear ?? null, dueDate: data.dueDate ?? null };
  const changed = (Object.keys(next) as (keyof typeof next)[]).filter((k) => next[k] !== existing[k]);
  if (changed.length === 0) return existing;

  return db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const [updated] = await t
      .update(engagements)
      .set({ ...next, updatedAt: new Date() })
      .where(eq(engagements.id, engagementId))
      .returning();
    if (!updated) throw new NotFoundError();
    if (changed.includes("ownerId")) await ensureAssignment(t, existing.clientId, data.ownerId);
    await recordAudit(t, {
      actorUserId: actor.userId,
      action: "engagement.update",
      entityType: "engagement",
      entityId: engagementId,
      metadata: { changedFields: changed, ...(changed.includes("status") ? { from: existing.status, to: data.status } : {}) },
    });
    if (changed.includes("ownerId")) {
      await recordAudit(t, {
        actorUserId: actor.userId,
        action: "client.assign",
        entityType: "client",
        entityId: existing.clientId,
        metadata: { userId: data.ownerId, reason: "engagement_owner", engagementId },
      });
    }
    return updated;
  });
}

/** Changes only the status of an engagement (bulk actions, board moves). */
export async function setEngagementStatus(db: Db, actor: Actor, engagementId: string, status: EngagementStatus): Promise<void> {
  const existing = await loadEngagementForStaff(db, actor, engagementId);
  if (!engagements.status.enumValues.includes(status)) throw new ValidationError({ status: ["Choose a status."] });
  if (existing.status === status) return;
  await db.update(engagements).set({ status, updatedAt: new Date() }).where(eq(engagements.id, engagementId));
  await recordAudit(db, {
    actorUserId: actor.userId,
    action: "engagement.update",
    entityType: "engagement",
    entityId: engagementId,
    metadata: { changedFields: ["status"], from: existing.status, to: status },
  });
}

export async function createTask(db: Db, actor: Actor, engagementId: string, input: unknown): Promise<Task> {
  const engagement = await loadEngagementForStaff(db, actor, engagementId);
  const data = parseInput(taskInputSchema, input);
  if (data.isClientTask && data.assigneeId) {
    // Client tasks belong to the client, not to a staff member.
    data.assigneeId = undefined;
  }
  if (data.assigneeId) {
    requireCanAssign(actor, data.assigneeId);
    await assertActiveStaffUser(db, data.assigneeId, "assigneeId");
    // The assignee must be able to open the engagement their task belongs to.
    await ensureAssignment(db, engagement.clientId, data.assigneeId);
  }
  const [task] = await db
    .insert(tasks)
    .values({
      engagementId: engagement.id,
      title: data.title,
      isClientTask: data.isClientTask,
      assigneeId: data.assigneeId ?? null,
      dueDate: data.dueDate ?? null,
    })
    .returning();
  if (!task) throw new Error("Insert returned no row");
  await recordAudit(db, {
    actorUserId: actor.userId,
    action: "task.create",
    entityType: "task",
    entityId: task.id,
    metadata: { engagementId: engagement.id, isClientTask: data.isClientTask },
  });
  if (data.assigneeId) {
    await recordAudit(db, {
      actorUserId: actor.userId,
      action: "task.assign",
      entityType: "task",
      entityId: task.id,
      metadata: { userId: data.assigneeId, engagementId: engagement.id },
    });
  }
  return task;
}

/**
 * Marks a task done or reopens it.
 *  - Staff: any task on an engagement they can access.
 *  - Clients: only client-facing tasks on their own engagements, and only to mark done.
 */
export async function setTaskStatus(db: Db, actor: Actor, taskId: string, status: "open" | "done"): Promise<Task> {
  if (!isUuid(taskId)) throw new NotFoundError();
  const [row] = await db
    .select({ task: tasks, clientId: engagements.clientId })
    .from(tasks)
    .innerJoin(engagements, eq(engagements.id, tasks.engagementId))
    .where(eq(tasks.id, taskId))
    .limit(1);
  if (!row) throw new NotFoundError();

  if (actor.role === "client") {
    if (!actor.clientId || row.clientId !== actor.clientId || !row.task.isClientTask) throw new NotFoundError();
    if (status !== "done") throw new NotFoundError();
  } else {
    await assertClientAccess(db, actor, row.clientId);
  }

  if (row.task.status === status) return row.task;
  const [updated] = await db
    .update(tasks)
    .set({
      status,
      completedAt: status === "done" ? new Date() : null,
      completedById: status === "done" ? actor.userId : null,
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, taskId))
    .returning();
  if (!updated) throw new NotFoundError();
  await recordAudit(db, {
    actorUserId: actor.userId,
    action: status === "done" ? "task.complete" : "task.reopen",
    entityType: "task",
    entityId: taskId,
  });
  return updated;
}

/** Active staff for owner/assignee pickers. */
export async function listStaff(db: Db, actor: Actor) {
  requireStaff(actor);
  return db
    .select({ id: users.id, name: users.name, role: users.role })
    .from(users)
    .where(and(eq(users.isActive, true), inArray(users.role, ["admin", "partner", "preparer"])))
    .orderBy(asc(users.name));
}
