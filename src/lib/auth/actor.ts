import type { UserRole } from "@/db/schema";

/** The authenticated user on whose behalf a service call runs. */
export interface Actor {
  userId: string;
  /** The firm (tenant) this user belongs to. Every service call is limited to it. */
  firmId: string;
  role: UserRole;
  /** Only for role = 'client'. */
  clientId: string | null;
  name: string;
  email: string;
}

/** Builds the actor for a user row. The one place that maps users → Actor. */
export function actorFromUser(user: { id: string; firmId: string; role: UserRole; clientId: string | null; name: string; email: string }): Actor {
  return { userId: user.id, firmId: user.firmId, role: user.role, clientId: user.clientId, name: user.name, email: user.email };
}

export type StaffRole = Exclude<UserRole, "client">;

export const STAFF_ROLES: readonly StaffRole[] = ["super_admin", "admin", "manager", "employee", "read_only"];
/** Roles that can own or be assigned work (read-only users cannot). */
export const ASSIGNABLE_ROLES: ("admin" | "manager" | "employee")[] = ["admin", "manager", "employee"];

export function isStaff(actor: Actor): boolean {
  return actor.role !== "client";
}

/**
 * Record VISIBILITY: admins, managers and read-only users see every client of their firm;
 * employees only clients assigned to them. Visibility never implies permission to change
 * anything — use `can()` from ./permissions for that.
 */
export function seesAllClients(actor: Actor): boolean {
  return actor.role === "super_admin" || actor.role === "admin" || actor.role === "manager" || actor.role === "read_only";
}

/** Admins and managers: approvals, closing, cancelling, reassigning other people's work. */
export function isManagerOrAdmin(actor: Actor): boolean {
  return actor.role === "super_admin" || actor.role === "admin" || actor.role === "manager";
}
