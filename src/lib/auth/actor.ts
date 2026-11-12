import type { UserRole } from "@/db/schema";

/** The authenticated user on whose behalf a service call runs. */
export interface Actor {
  userId: string;
  role: UserRole;
  /** Only for role = 'client'. */
  clientId: string | null;
  name: string;
  email: string;
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
