import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db";
import { users } from "@/db/schema";
import { AuthenticationError } from "@/lib/errors";
import { recordAudit } from "@/services/audit";
import type { Actor } from "./actor";
import { PASSWORD_MAX_LENGTH, verifyAgainstDummy, verifyPassword } from "./crypto";
import { createSession, type NewSession } from "./sessions";

export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MS = 15 * 60 * 1000;

/** One message for every failure so attackers cannot tell which part was wrong. */
export const LOGIN_FAILED_MESSAGE = "Incorrect email or password, or the account is temporarily locked.";

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().min(3).max(254),
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});

export async function login(
  db: Db,
  input: { email: unknown; password: unknown },
  now = new Date(),
): Promise<NewSession & { actor: Actor }> {
  const parsed = credentialsSchema.safeParse(input);
  if (!parsed.success) throw new AuthenticationError(LOGIN_FAILED_MESSAGE);
  const { email, password } = parsed.data;

  const [user] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`)
    .limit(1);

  if (!user || !user.passwordHash || !user.isActive) {
    await verifyAgainstDummy(password);
    throw new AuthenticationError(LOGIN_FAILED_MESSAGE);
  }

  if (user.lockedUntil && user.lockedUntil.getTime() > now.getTime()) {
    await verifyAgainstDummy(password);
    await recordAudit(db, { actorUserId: user.id, action: "auth.login_blocked_locked", entityType: "user", entityId: user.id });
    throw new AuthenticationError(LOGIN_FAILED_MESSAGE);
  }

  if (!(await verifyPassword(user.passwordHash, password))) {
    const failed = user.failedLoginCount + 1;
    const lock = failed >= MAX_FAILED_LOGINS;
    await db
      .update(users)
      .set({
        failedLoginCount: lock ? 0 : failed,
        lockedUntil: lock ? new Date(now.getTime() + LOCKOUT_MS) : user.lockedUntil,
      })
      .where(eq(users.id, user.id));
    await recordAudit(db, {
      actorUserId: user.id,
      action: lock ? "auth.account_locked" : "auth.login_failed",
      entityType: "user",
      entityId: user.id,
    });
    throw new AuthenticationError(LOGIN_FAILED_MESSAGE);
  }

  await db.update(users).set({ failedLoginCount: 0, lockedUntil: null }).where(eq(users.id, user.id));
  const session = await createSession(db, user.id, now);
  await recordAudit(db, { actorUserId: user.id, action: "auth.login", entityType: "user", entityId: user.id });

  return {
    ...session,
    actor: { userId: user.id, role: user.role, clientId: user.clientId, name: user.name, email: user.email },
  };
}
