import { eq, lt } from "drizzle-orm";
import type { Db } from "@/db";
import { sessions, users } from "@/db/schema";
import { actorFromUser, type Actor } from "./actor";
import { generateToken, hashToken } from "./crypto";

/** Idle timeout: a session unused for this long expires. */
export const SESSION_IDLE_MS = 8 * 60 * 60 * 1000;
/** Absolute lifetime regardless of activity. */
export const SESSION_ABSOLUTE_MS = 12 * 60 * 60 * 1000;

export interface NewSession {
  token: string;
  expiresAt: Date;
}

export async function createSession(db: Db, userId: string, now = new Date()): Promise<NewSession> {
  const token = generateToken();
  const expiresAt = new Date(now.getTime() + SESSION_IDLE_MS);
  await db.insert(sessions).values({ id: hashToken(token), userId, expiresAt, createdAt: now });
  return { token, expiresAt };
}

/**
 * Returns the actor for a valid session token, or null. Expired sessions and
 * sessions of deactivated users are deleted. Active sessions slide forward
 * (idle timeout) up to the absolute lifetime.
 */
export async function validateSessionToken(db: Db, token: string, now = new Date()): Promise<Actor | null> {
  if (!token || token.length > 200) return null;
  const id = hashToken(token);
  const [row] = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, id))
    .limit(1);
  if (!row) return null;

  const { session, user } = row;
  const absoluteEnd = session.createdAt.getTime() + SESSION_ABSOLUTE_MS;
  if (now.getTime() >= session.expiresAt.getTime() || now.getTime() >= absoluteEnd || !user.isActive) {
    await db.delete(sessions).where(eq(sessions.id, id));
    return null;
  }

  // Slide the idle window once less than half of it remains.
  if (session.expiresAt.getTime() - now.getTime() < SESSION_IDLE_MS / 2) {
    const next = new Date(Math.min(now.getTime() + SESSION_IDLE_MS, absoluteEnd));
    await db.update(sessions).set({ expiresAt: next }).where(eq(sessions.id, id));
  }

  return actorFromUser(user);
}

export async function invalidateSession(db: Db, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, hashToken(token)));
}

export async function invalidateUserSessions(db: Db, userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

export async function deleteExpiredSessions(db: Db, now = new Date()): Promise<void> {
  await db.delete(sessions).where(lt(sessions.expiresAt, now));
}
