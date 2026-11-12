import { and, eq, exists, type SQL } from "drizzle-orm";
import type { Db } from "@/db";
import { clientAssignments, clients, users } from "@/db/schema";
import { isStaff, seesAllClients, type Actor } from "@/lib/auth/actor";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { isUuid } from "@/lib/validation";

/**
 * Central authorization rules. Every service that touches client-specific data
 * goes through these helpers; the UI is never relied on for access control.
 */

export function requireStaff(actor: Actor): void {
  if (!isStaff(actor)) throw new ForbiddenError();
}

/** Preparers may assign work to themselves; only admins and partners can delegate it. */
export function requireCanAssign(actor: Actor, assigneeId: string): void {
  requireStaff(actor);
  if (actor.role === "preparer" && assigneeId !== actor.userId) {
    throw new ForbiddenError("Only an admin or partner can assign work to another staff member.");
  }
}

/** SQL condition limiting `clients` rows to those the staff actor may see (undefined = all). */
export function visibleClientsCondition(db: Db, actor: Actor): SQL | undefined {
  requireStaff(actor);
  if (seesAllClients(actor)) return undefined;
  return exists(
    db
      .select({ one: clientAssignments.clientId })
      .from(clientAssignments)
      .where(and(eq(clientAssignments.clientId, clients.id), eq(clientAssignments.userId, actor.userId))),
  );
}

/** Throws NotFoundError unless the staff actor may access this client. */
export async function assertClientAccess(db: Db, actor: Actor, clientId: string): Promise<void> {
  requireStaff(actor);
  if (!isUuid(clientId)) throw new NotFoundError();
  const condition = visibleClientsCondition(db, actor);
  const [row] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(condition ? and(eq(clients.id, clientId), condition) : eq(clients.id, clientId))
    .limit(1);
  if (!row) throw new NotFoundError();
}

/** Grants a staff member access to a client (idempotent). */
export async function ensureAssignment(db: Db, clientId: string, userId: string): Promise<void> {
  await db.insert(clientAssignments).values({ clientId, userId }).onConflictDoNothing();
}

/** Validates that a user id refers to an active staff member; returns their role. */
export async function assertActiveStaffUser(db: Db, userId: string, field: string): Promise<{ role: string }> {
  const [user] = await db
    .select({ role: users.role, isActive: users.isActive })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user || !user.isActive || user.role === "client") {
    throw new ValidationError({ [field]: ["Choose an active staff member."] });
  }
  return { role: user.role };
}
