import { and, eq, exists, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { Db } from "@/db";
import { clientAssignments, clients, users } from "@/db/schema";
import { isStaff, seesAllClients, type Actor } from "@/lib/auth/actor";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { isUuid } from "@/lib/validation";
import { can, type Action, type Module } from "@/lib/auth/permissions";

/**
 * Central authorization rules. Every service that touches client-specific data
 * goes through these helpers; the UI is never relied on for access control.
 *
 * TENANCY: every firm-owned table has `firm_id`. Every query must be limited to
 * `actor.firmId` (use `inFirm(table.firmId, actor)`) and every insert must set
 * `firmId: actor.firmId`. Composite foreign keys in the database reject any row
 * that links to another firm's client, engagement or staff member.
 */

/** `<table>.firm_id = actor's firm`. Include in EVERY query on a firm-owned table. */
export function inFirm(column: PgColumn, actor: Pick<Actor, "firmId">): SQL {
  return eq(column, actor.firmId);
}

export function requireStaff(actor: Actor): void {
  if (!isStaff(actor)) throw new ForbiddenError();
}

/** Staff who may change records (everyone except read-only users and clients). */
export function requireWriter(actor: Actor): void {
  requireStaff(actor);
  if (actor.role === "read_only") throw new ForbiddenError("Your account is read-only.");
}

/** Throws unless the actor holds this permission (see lib/auth/permissions.ts). */
export function requirePermission(actor: Actor, module: Module, action: Action): void {
  requireStaff(actor);
  if (!can(actor, module, action)) {
    throw new ForbiddenError(actor.role === "read_only" ? "Your account is read-only." : "You do not have permission to do that.");
  }
}

/** Employees may assign work to themselves; only admins and managers can delegate it. */
export function requireCanAssign(actor: Actor, assigneeId: string): void {
  requireWriter(actor);
  if (actor.role === "employee" && assigneeId !== actor.userId) {
    throw new ForbiddenError("Only an admin or manager can assign work to another staff member.");
  }
}

/**
 * SQL condition limiting `clients` rows to those the staff actor may see:
 * always their own firm, and for preparers only clients assigned to them.
 */
export function visibleClientsCondition(db: Db, actor: Actor): SQL {
  requireStaff(actor);
  const firm = inFirm(clients.firmId, actor);
  if (seesAllClients(actor)) return firm;
  return and(
    firm,
    exists(
      db
        .select({ one: clientAssignments.clientId })
        .from(clientAssignments)
        .where(and(eq(clientAssignments.clientId, clients.id), eq(clientAssignments.userId, actor.userId))),
    ),
  )!;
}

/** Throws NotFoundError unless the staff actor may access this client (same firm; assigned, for preparers). */
export async function assertClientAccess(db: Db, actor: Actor, clientId: string): Promise<void> {
  requireStaff(actor);
  if (!isUuid(clientId)) throw new NotFoundError();
  const [row] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.id, clientId), visibleClientsCondition(db, actor)))
    .limit(1);
  if (!row) throw new NotFoundError();
}

/** Grants a staff member access to a client (idempotent). Both must belong to `firmId` (enforced by the database). */
export async function ensureAssignment(db: Db, firmId: string, clientId: string, userId: string): Promise<void> {
  await db.insert(clientAssignments).values({ firmId, clientId, userId }).onConflictDoNothing();
}

/** Validates that a user id is an active staff member OF THE ACTOR'S FIRM; returns their role. */
export async function assertActiveStaffUser(db: Db, actor: Pick<Actor, "firmId">, userId: string, field: string): Promise<{ role: string }> {
  const invalid = new ValidationError({ [field]: ["Choose an active staff member."] });
  if (!isUuid(userId)) throw invalid;
  const [user] = await db
    .select({ role: users.role, isActive: users.isActive })
    .from(users)
    .where(and(eq(users.id, userId), inFirm(users.firmId, actor)))
    .limit(1);
  // Read-only users and clients can't own or be assigned work.
  if (!user || !user.isActive || user.role === "client" || user.role === "read_only") throw invalid;
  return { role: user.role };
}
