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

export const STAFF_ROLES: readonly StaffRole[] = [
  "super_admin", "admin", "administrator", "operations_manager", "project_manager", "team_member",
  "sales_manager", "sales_representative", "finance_manager", "accountant", "marketing_manager",
  "account_manager", "support_agent", "developer", "manager", "employee", "read_only",
];
/** Roles that can own or be assigned work (read-only users cannot). */
export const ASSIGNABLE_ROLES: StaffRole[] = [
  "admin", "administrator", "operations_manager", "project_manager", "team_member", "sales_manager",
  "sales_representative", "finance_manager", "accountant", "account_manager", "support_agent", "manager", "employee",
];

export function isOwner(actor: Pick<Actor, "role">): boolean {
  return actor.role === "admin";
}

export function canManageTeam(actor: Pick<Actor, "role">): boolean {
  return actor.role === "super_admin" || actor.role === "admin" || actor.role === "administrator";
}

export function isStaff(actor: Actor): boolean {
  return actor.role !== "client";
}

/**
 * Record VISIBILITY: admins, managers and read-only users see every client of their firm;
 * employees only clients assigned to them. Visibility never implies permission to change
 * anything — use `can()` from ./permissions for that.
 */
export function seesAllClients(actor: Actor): boolean {
  return ["super_admin", "admin", "administrator", "operations_manager", "manager", "project_manager", "sales_manager", "finance_manager", "accountant", "marketing_manager", "read_only"].includes(actor.role);
}

/** Admins and managers: approvals, closing, cancelling, reassigning other people's work. */
export function isManagerOrAdmin(actor: Actor): boolean {
  return ["super_admin", "admin", "administrator", "operations_manager", "manager", "project_manager", "finance_manager"].includes(actor.role);
}
