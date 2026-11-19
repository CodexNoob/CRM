import { and, asc, eq, ne, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { users, type UserRole } from "@/db/schema";
import { canManageTeam, isOwner, type Actor } from "@/lib/auth/actor";
import { invalidateUserSessions } from "@/lib/auth/sessions";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { isUuid, parseInput, staffInviteSchema, staffRoleSchema } from "@/lib/validation";
import { inFirm } from "./access";
import { recordAudit } from "./audit";
import { createStaffInvitation, findUserByEmail, issueInvitation } from "./users";

/** Staff account management. Admin only; every rule is enforced here, not in the UI. */

function requireAdmin(actor: Actor): void {
  if (!canManageTeam(actor)) throw new ForbiddenError();
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: Exclude<UserRole, "client">;
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
    .where(and(
      inFirm(users.firmId, actor),
      ne(users.role, "client"),
      actor.role === "super_admin" ? undefined : ne(users.role, "super_admin"),
    ))
    .orderBy(asc(users.name));
  return rows as TeamMember[];
}

/** Adds a new staff member and returns their one-time sign-in link token. */
export async function inviteStaff(db: Db, actor: Actor, input: unknown): Promise<{ token: string; userId: string }> {
  requireAdmin(actor);
  const data = parseInput(staffInviteSchema, input);
  if (actor.role === "administrator" && data.role === "administrator") throw new ForbiddenError("Only the Owner can assign the Administrator role.");
  if (data.role === "admin") throw new ValidationError({ role: ["The Owner role is reserved for the account that created the firm."] });
  if (data.role === "super_admin" && actor.role !== "super_admin") throw new ForbiddenError();
  if (await findUserByEmail(db, data.email)) {
    throw new ValidationError({ email: ["Someone already has an account with this email. Use the send password setup email action on their row instead."] });
  }
  return createStaffInvitation(db, actor.firmId, data, actor);
}

async function loadStaffTarget(db: Db, actor: Actor, userId: string) {
  requireAdmin(actor);
  if (!isUuid(userId)) throw new NotFoundError();
  const [user] = await db.select().from(users).where(and(eq(users.id, userId), inFirm(users.firmId, actor))).limit(1);
  if (!user || user.role === "client") throw new NotFoundError();
  if (user.role === "super_admin" && actor.role !== "super_admin") throw new NotFoundError();
  return user;
}

async function otherActiveAdmins(db: Db, firmId: string, excludeUserId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(users)
    .where(and(eq(users.firmId, firmId), eq(users.role, "admin"), eq(users.isActive, true), ne(users.id, excludeUserId)));
  return row?.n ?? 0;
}

/** New one-time sign-in link for a staff member. Also serves as a password reset. */
export async function sendStaffSignInLink(db: Db, actor: Actor, userId: string): Promise<{ token: string; name: string; email: string }> {
  const user = await loadStaffTarget(db, actor, userId);
  if (!user.isActive) throw new ValidationError({ _form: ["Reactivate this account before sending a sign-in link."] });
  const token = await issueInvitation(db, user.id, actor.userId);
  await recordAudit(db, { firmId: actor.firmId, actorUserId: actor.userId, action: "staff.signin_link", entityType: "user", entityId: user.id });
  return { token, name: user.name, email: user.email };
}

export async function setStaffActive(db: Db, actor: Actor, userId: string, active: boolean): Promise<void> {
  const user = await loadStaffTarget(db, actor, userId);
  if (user.id === actor.userId) throw new ValidationError({ _form: ["You cannot deactivate your own account."] });
  if (!active && isOwner({ role: user.role }) && (await otherActiveAdmins(db, actor.firmId, user.id)) === 0) {
    throw new ValidationError({ _form: ["The firm needs at least one active admin."] });
  }
  if (user.isActive === active) return;
  await db.update(users).set({ isActive: active, updatedAt: new Date() }).where(and(eq(users.id, user.id), inFirm(users.firmId, actor)));
  if (!active) await invalidateUserSessions(db, user.id);
  await recordAudit(db, {
    firmId: actor.firmId,
    actorUserId: actor.userId,
    action: active ? "staff.reactivate" : "staff.deactivate",
    entityType: "user",
    entityId: user.id,
  });
}

export async function changeStaffRole(db: Db, actor: Actor, userId: string, role: unknown): Promise<void> {
  const user = await loadStaffTarget(db, actor, userId);
  const next = parseInput(staffRoleSchema, role);
  if (next === "admin" || isOwner({ role: user.role })) throw new ValidationError({ role: ["The firm Owner role cannot be assigned or changed here."] });
  if (next === "super_admin" && actor.role !== "super_admin") throw new ForbiddenError();
  if (actor.role === "administrator" && next === "administrator") throw new ForbiddenError("Only the Owner can assign the Administrator role.");
  if (user.id === actor.userId) throw new ValidationError({ _form: ["You cannot change your own role."] });
  if (user.role === next) return;
  await db.update(users).set({ role: next, updatedAt: new Date() }).where(and(eq(users.id, user.id), inFirm(users.firmId, actor)));
  // Permissions change immediately: force a fresh sign-in.
  await invalidateUserSessions(db, user.id);
  await recordAudit(db, {
    firmId: actor.firmId,
    actorUserId: actor.userId,
    action: "staff.role_change",
    entityType: "user",
    entityId: user.id,
    metadata: { from: user.role, to: next },
  });
}
