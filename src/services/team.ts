import { and, asc, eq, ne, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { users } from "@/db/schema";
import type { Actor } from "@/lib/auth/actor";
import { invalidateUserSessions } from "@/lib/auth/sessions";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { isUuid, parseInput, staffInviteSchema, staffRoleSchema } from "@/lib/validation";
import { recordAudit } from "./audit";
import { createStaffInvitation, findUserByEmail, issueInvitation } from "./users";

/** Staff account management. Admin only; every rule is enforced here, not in the UI. */

function requireAdmin(actor: Actor): void {
  if (actor.role !== "admin") throw new ForbiddenError();
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: "admin" | "partner" | "preparer";
  isActive: boolean;
  hasPassword: boolean;
  createdAt: Date;
}

export async function listTeam(db: Db, actor: Actor): Promise<TeamMember[]> {
  requireAdmin(actor);
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      isActive: users.isActive,
      hasPassword: sql<boolean>`${users.passwordHash} is not null`,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(ne(users.role, "client"))
    .orderBy(asc(users.name));
  return rows as TeamMember[];
}

/** Adds a new staff member and returns their one-time sign-in link token. */
export async function inviteStaff(db: Db, actor: Actor, input: unknown): Promise<{ token: string; userId: string }> {
  requireAdmin(actor);
  const data = parseInput(staffInviteSchema, input);
  if (await findUserByEmail(db, data.email)) {
    throw new ValidationError({ email: ["Someone already has an account with this email. Use “New sign-in link” on their row instead."] });
  }
  return createStaffInvitation(db, data, actor);
}

async function loadStaffTarget(db: Db, actor: Actor, userId: string) {
  requireAdmin(actor);
  if (!isUuid(userId)) throw new NotFoundError();
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user || user.role === "client") throw new NotFoundError();
  return user;
}

async function otherActiveAdmins(db: Db, excludeUserId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(users)
    .where(and(eq(users.role, "admin"), eq(users.isActive, true), ne(users.id, excludeUserId)));
  return row?.n ?? 0;
}

/** New one-time sign-in link for a staff member. Also serves as a password reset. */
export async function sendStaffSignInLink(db: Db, actor: Actor, userId: string): Promise<{ token: string }> {
  const user = await loadStaffTarget(db, actor, userId);
  if (!user.isActive) throw new ValidationError({ _form: ["Reactivate this account before sending a sign-in link."] });
  const token = await issueInvitation(db, user.id, actor.userId);
  await recordAudit(db, { actorUserId: actor.userId, action: "staff.signin_link", entityType: "user", entityId: user.id });
  return { token };
}

export async function setStaffActive(db: Db, actor: Actor, userId: string, active: boolean): Promise<void> {
  const user = await loadStaffTarget(db, actor, userId);
  if (user.id === actor.userId) throw new ValidationError({ _form: ["You can’t deactivate your own account."] });
  if (!active && user.role === "admin" && (await otherActiveAdmins(db, user.id)) === 0) {
    throw new ValidationError({ _form: ["The firm needs at least one active admin."] });
  }
  if (user.isActive === active) return;
  await db.update(users).set({ isActive: active, updatedAt: new Date() }).where(eq(users.id, user.id));
  if (!active) await invalidateUserSessions(db, user.id);
  await recordAudit(db, {
    actorUserId: actor.userId,
    action: active ? "staff.reactivate" : "staff.deactivate",
    entityType: "user",
    entityId: user.id,
  });
}

export async function changeStaffRole(db: Db, actor: Actor, userId: string, role: unknown): Promise<void> {
  const user = await loadStaffTarget(db, actor, userId);
  const next = parseInput(staffRoleSchema, role);
  if (user.id === actor.userId) throw new ValidationError({ _form: ["You can’t change your own role."] });
  if (user.role === next) return;
  if (user.role === "admin" && user.isActive && (await otherActiveAdmins(db, user.id)) === 0) {
    throw new ValidationError({ _form: ["The firm needs at least one active admin."] });
  }
  await db.update(users).set({ role: next, updatedAt: new Date() }).where(eq(users.id, user.id));
  // Permissions change immediately: force a fresh sign-in.
  await invalidateUserSessions(db, user.id);
  await recordAudit(db, {
    actorUserId: actor.userId,
    action: "staff.role_change",
    entityType: "user",
    entityId: user.id,
    metadata: { from: user.role, to: next },
  });
}
