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

export const STAFF_ROLES: readonly StaffRole[] = ["admin", "partner", "preparer"];

export function isStaff(actor: Actor): boolean {
  return actor.role !== "client";
}

/** Admins and partners see every client; preparers only clients assigned to them. */
export function seesAllClients(actor: Actor): boolean {
  return actor.role === "admin" || actor.role === "partner";
}
