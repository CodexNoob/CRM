import { desc, eq, and } from "drizzle-orm";
import type { Db } from "@/db";
import { auditEvents, users } from "@/db/schema";
import type { Actor } from "@/lib/auth/actor";
import { ForbiddenError } from "@/lib/errors";

export interface AuditInput {
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  /** Field NAMES or non-sensitive context only. Never values of client data, tokens or passwords. */
  metadata?: Record<string, unknown>;
}

export async function recordAudit(db: Db, event: AuditInput): Promise<void> {
  await db.insert(auditEvents).values({
    actorUserId: event.actorUserId,
    action: event.action,
    entityType: event.entityType,
    entityId: event.entityId ?? null,
    metadata: event.metadata ?? null,
  });
}

export interface ActivityRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actorName: string | null;
  createdAt: Date;
}

/** Firm-wide audit trail, newest first. Admin only. Metadata is not returned. */
export async function listRecentActivity(db: Db, actor: Actor, opts: { limit?: number } = {}): Promise<ActivityRow[]> {
  if (actor.role !== "admin") throw new ForbiddenError();
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  return db
    .select({
      id: auditEvents.id,
      action: auditEvents.action,
      entityType: auditEvents.entityType,
      entityId: auditEvents.entityId,
      actorName: users.name,
      createdAt: auditEvents.createdAt,
    })
    .from(auditEvents)
    .leftJoin(users, eq(users.id, auditEvents.actorUserId))
    .orderBy(desc(auditEvents.createdAt))
    .limit(limit);
}

/** Audit history for one record. Admin only. */
export async function listAuditEvents(db: Db, actor: Actor, entityType: string, entityId: string) {
  if (actor.role !== "admin") throw new ForbiddenError();
  return db
    .select()
    .from(auditEvents)
    .where(and(eq(auditEvents.entityType, entityType), eq(auditEvents.entityId, entityId)))
    .orderBy(desc(auditEvents.createdAt))
    .limit(200);
}
