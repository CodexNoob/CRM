import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { activities, firmCounters, statusHistory, users, type ActivityType } from "@/db/schema";
import type { Actor } from "@/lib/auth/actor";

/**
 * Shared workflow plumbing used by leads, clients, engagements and tasks:
 *  - per-firm record numbers (L-0001 …),
 *  - the business activity timeline (notes, calls, assignments, status changes),
 *  - status history (who changed what, when).
 * Callers are responsible for access checks; these helpers only write/read rows of `firmId`.
 */

export type EntityType = "lead" | "client" | "engagement" | "task" | "tax_preparation" | "tax_return";
export type CounterKind = "lead" | "client" | "engagement" | "task";

/** Next number for a firm. Atomic (single upsert), so concurrent inserts never share a number. */
export async function nextNumber(db: Db, firmId: string, kind: CounterKind): Promise<number> {
  const [row] = await db
    .insert(firmCounters)
    .values({ firmId, kind, value: 1 })
    .onConflictDoUpdate({ target: [firmCounters.firmId, firmCounters.kind], set: { value: sql`${firmCounters.value} + 1` } })
    .returning({ value: firmCounters.value });
  return row!.value;
}

export interface ActivityInput {
  entityType: EntityType;
  entityId: string;
  clientId?: string | null;
  type: ActivityType;
  body?: string | null;
  metadata?: Record<string, unknown>;
  occurredAt?: Date;
}

export async function logActivity(db: Db, who: { firmId: string; userId: string | null }, a: ActivityInput): Promise<void> {
  await db.insert(activities).values({
    firmId: who.firmId,
    actorId: who.userId,
    entityType: a.entityType,
    entityId: a.entityId,
    clientId: a.clientId ?? null,
    type: a.type,
    body: a.body ?? null,
    metadata: a.metadata ?? null,
    occurredAt: a.occurredAt ?? new Date(),
  });
}

/** Records a status change in status_history AND on the activity timeline. No-op if unchanged. */
export async function recordStatusChange(
  db: Db,
  who: { firmId: string; userId: string | null },
  e: { entityType: EntityType; entityId: string; clientId?: string | null; from: string | null; to: string; note?: string | null },
): Promise<void> {
  if (e.from === e.to) return;
  await db.insert(statusHistory).values({
    firmId: who.firmId,
    entityType: e.entityType,
    entityId: e.entityId,
    oldStatus: e.from,
    newStatus: e.to,
    changedById: who.userId,
    note: e.note ?? null,
  });
  await logActivity(db, who, { entityType: e.entityType, entityId: e.entityId, clientId: e.clientId, type: "status_change", body: e.note ?? null, metadata: { from: e.from, to: e.to } });
}

export interface TimelineItem {
  id: string;
  type: ActivityType;
  body: string | null;
  metadata: Record<string, unknown> | null;
  occurredAt: Date;
  actorName: string | null;
  entityType: string;
  entityId: string;
}

const timelineCols = {
  id: activities.id,
  type: activities.type,
  body: activities.body,
  metadata: activities.metadata,
  occurredAt: activities.occurredAt,
  actorName: users.name,
  entityType: activities.entityType,
  entityId: activities.entityId,
};

/** Timeline of one record, newest first. Caller must have checked access to the record. */
export async function listEntityTimeline(db: Db, actor: Pick<Actor, "firmId">, entityType: EntityType, entityId: string, limit = 100): Promise<TimelineItem[]> {
  return db
    .select(timelineCols)
    .from(activities)
    .leftJoin(users, eq(users.id, activities.actorId))
    .where(and(eq(activities.firmId, actor.firmId), eq(activities.entityType, entityType), eq(activities.entityId, entityId)))
    .orderBy(desc(activities.occurredAt), desc(activities.createdAt))
    .limit(limit);
}

/** Everything that happened on a client and its engagements/tasks. Caller must have checked client access. */
export async function listClientTimeline(db: Db, actor: Pick<Actor, "firmId">, clientId: string, limit = 100): Promise<TimelineItem[]> {
  return db
    .select(timelineCols)
    .from(activities)
    .leftJoin(users, eq(users.id, activities.actorId))
    .where(and(eq(activities.firmId, actor.firmId), eq(activities.clientId, clientId)))
    .orderBy(desc(activities.occurredAt), desc(activities.createdAt))
    .limit(limit);
}

export interface StatusHistoryItem {
  id: string;
  oldStatus: string | null;
  newStatus: string;
  note: string | null;
  changedByName: string | null;
  createdAt: Date;
}

export async function listStatusHistory(db: Db, actor: Pick<Actor, "firmId">, entityType: EntityType, entityId: string): Promise<StatusHistoryItem[]> {
  return db
    .select({ id: statusHistory.id, oldStatus: statusHistory.oldStatus, newStatus: statusHistory.newStatus, note: statusHistory.note, changedByName: users.name, createdAt: statusHistory.createdAt })
    .from(statusHistory)
    .leftJoin(users, eq(users.id, statusHistory.changedById))
    .where(and(eq(statusHistory.firmId, actor.firmId), eq(statusHistory.entityType, entityType), eq(statusHistory.entityId, entityId)))
    .orderBy(asc(statusHistory.createdAt));
}
