import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { invitations, users, type User } from "@/db/schema";
import type { Actor, StaffRole } from "@/lib/auth/actor";
import { generateToken, hashPassword, hashToken } from "@/lib/auth/crypto";
import { invalidateUserSessions } from "@/lib/auth/sessions";
import { AppError, ForbiddenError, ValidationError } from "@/lib/errors";
import { parseInput, passwordSchema, portalInviteSchema } from "@/lib/validation";
import { recordAudit } from "./audit";
import { assertClientAccess } from "./access";

export const INVITATION_TTL_MS = 72 * 60 * 60 * 1000;

export class InvalidInvitationError extends AppError {
  constructor() {
    super("This invitation link is invalid or has expired. Ask the firm for a new one.");
  }
}

export async function findUserByEmail(db: Db, email: string): Promise<User | undefined> {
  const [user] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${email.toLowerCase()}`)
    .limit(1);
  return user;
}

/** Issues a new one-time invitation token for a user, revoking older unused ones. */
export async function issueInvitation(db: Db, userId: string, createdById: string | null, now = new Date()): Promise<string> {
  await db.delete(invitations).where(and(eq(invitations.userId, userId), isNull(invitations.usedAt)));
  const token = generateToken();
  await db.insert(invitations).values({
    id: hashToken(token),
    userId,
    createdById,
    expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
  });
  return token;
}

/**
 * Creates (or re-invites) a portal login for a client. Returns a one-time token
 * that staff send to the client as a link. The token is never stored in plain text.
 */
export async function createPortalInvitation(
  db: Db,
  actor: Actor,
  clientId: string,
  input: unknown,
): Promise<{ token: string; userId: string }> {
  await assertClientAccess(db, actor, clientId);
  const data = parseInput(portalInviteSchema, input);
  const existing = await findUserByEmail(db, data.email);
  if (existing && (existing.role !== "client" || existing.clientId !== clientId)) {
    throw new ValidationError({ email: ["This email is already used by another account."] });
  }
  if (existing && !existing.isActive) {
    throw new ValidationError({ email: ["This portal login is deactivated."] });
  }

  return db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    let userId = existing?.id;
    if (!userId) {
      const [created] = await t
        .insert(users)
        .values({ email: data.email, name: data.name, role: "client", clientId })
        .returning({ id: users.id });
      if (!created) throw new Error("Insert returned no row");
      userId = created.id;
    }
    const token = await issueInvitation(t, userId, actor.userId);
    await recordAudit(t, {
      actorUserId: actor.userId,
      action: "portal.invite",
      entityType: "user",
      entityId: userId,
      metadata: { clientId },
    });
    return { token, userId };
  });
}

/** Creates a staff user and invitation. Used by the admin CLI (no web UI yet). */
export async function createStaffInvitation(
  db: Db,
  input: { email: string; name: string; role: StaffRole },
  actor: Actor | null,
): Promise<{ token: string; userId: string }> {
  if (actor && actor.role !== "admin") throw new ForbiddenError();
  const email = input.email.trim().toLowerCase();
  const existing = await findUserByEmail(db, email);
  if (existing && existing.role === "client") {
    throw new ValidationError({ email: ["This email belongs to a client portal login."] });
  }
  return db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    let userId = existing?.id;
    if (!userId) {
      const [created] = await t
        .insert(users)
        .values({ email, name: input.name.trim(), role: input.role })
        .returning({ id: users.id });
      if (!created) throw new Error("Insert returned no row");
      userId = created.id;
    }
    const token = await issueInvitation(t, userId, actor?.userId ?? null);
    await recordAudit(t, {
      actorUserId: actor?.userId ?? null,
      action: "staff.invite",
      entityType: "user",
      entityId: userId,
      metadata: { role: input.role },
    });
    return { token, userId };
  });
}

/** Sets the password for an invited user. The token can be used once. */
export async function acceptInvitation(db: Db, token: string, password: unknown, now = new Date()): Promise<void> {
  if (typeof token !== "string" || token.length < 20 || token.length > 200) throw new InvalidInvitationError();
  const pw = parseInput(passwordSchema.transform((p) => p), password);
  const [invite] = await db
    .select({ invite: invitations, isActive: users.isActive })
    .from(invitations)
    .innerJoin(users, eq(users.id, invitations.userId))
    .where(eq(invitations.id, hashToken(token)))
    .limit(1);
  if (!invite || invite.invite.usedAt || invite.invite.expiresAt.getTime() <= now.getTime() || !invite.isActive) {
    throw new InvalidInvitationError();
  }
  const passwordHash = await hashPassword(pw);
  await db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    // Conditional update makes the token single-use even under concurrent requests.
    const used = await t
      .update(invitations)
      .set({ usedAt: now })
      .where(and(eq(invitations.id, invite.invite.id), isNull(invitations.usedAt)))
      .returning({ id: invitations.id });
    if (used.length === 0) throw new InvalidInvitationError();
    await t
      .update(users)
      .set({ passwordHash, failedLoginCount: 0, lockedUntil: null, updatedAt: now })
      .where(eq(users.id, invite.invite.userId));
    await recordAudit(t, {
      actorUserId: invite.invite.userId,
      action: "auth.password_set",
      entityType: "user",
      entityId: invite.invite.userId,
    });
  });
  await invalidateUserSessions(db, invite.invite.userId);
}

export async function listPortalUsers(db: Db, actor: Actor, clientId: string) {
  await assertClientAccess(db, actor, clientId);
  return db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      isActive: users.isActive,
      hasPassword: sql<boolean>`${users.passwordHash} is not null`,
    })
    .from(users)
    .where(and(eq(users.clientId, clientId), eq(users.role, "client")));
}
