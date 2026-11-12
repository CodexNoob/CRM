import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DbHandle } from "@/db";
import { auditEvents, invitations, sessions, users } from "@/db/schema";
import { hashToken } from "@/lib/auth/crypto";
import { LOGIN_FAILED_MESSAGE, MAX_FAILED_LOGINS, LOCKOUT_MS, login } from "@/lib/auth/login";
import {
  SESSION_ABSOLUTE_MS,
  SESSION_IDLE_MS,
  createSession,
  invalidateSession,
  validateSessionToken,
} from "@/lib/auth/sessions";
import { AuthenticationError, ValidationError } from "@/lib/errors";
import { acceptInvitation, createStaffInvitation, InvalidInvitationError, INVITATION_TTL_MS } from "@/services/users";
import { createTestDb, createUser, deactivate, defaultFirmId } from "./helpers";

const PASSWORD = "correct horse battery staple";

let h: DbHandle;
beforeAll(async () => {
  h = await createTestDb();
});
afterAll(async () => {
  await h.close();
});

describe("login", () => {
  it("signs in with correct credentials, case-insensitive email", async () => {
    const staff = await createUser(h.db, { role: "preparer", password: PASSWORD });
    const result = await login(h.db, { email: staff.email.toUpperCase(), password: PASSWORD });
    expect(result.actor.userId).toBe(staff.userId);
    expect(result.token.length).toBeGreaterThan(30);
  });

  it("stores only a hash of the session token", async () => {
    const staff = await createUser(h.db, { role: "preparer", password: PASSWORD });
    const { token } = await login(h.db, { email: staff.email, password: PASSWORD });
    const rows = await h.db.select().from(sessions).where(eq(sessions.userId, staff.userId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(hashToken(token));
    expect(rows[0]!.id).not.toBe(token);
  });

  it("gives the same generic error for unknown email and wrong password", async () => {
    const staff = await createUser(h.db, { role: "preparer", password: PASSWORD });
    await expect(login(h.db, { email: "nobody@example.test", password: PASSWORD })).rejects.toThrow(LOGIN_FAILED_MESSAGE);
    await expect(login(h.db, { email: staff.email, password: "wrong password!!" })).rejects.toThrow(LOGIN_FAILED_MESSAGE);
  });

  it("rejects users who have not set a password, and deactivated users", async () => {
    const invited = await createUser(h.db, { role: "preparer" });
    await expect(login(h.db, { email: invited.email, password: PASSWORD })).rejects.toBeInstanceOf(AuthenticationError);
    const gone = await createUser(h.db, { role: "preparer", password: PASSWORD });
    await deactivate(h.db, gone.userId);
    await expect(login(h.db, { email: gone.email, password: PASSWORD })).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("locks the account after repeated failures, even for the right password", async () => {
    const staff = await createUser(h.db, { role: "preparer", password: PASSWORD });
    const now = new Date();
    for (let i = 0; i < MAX_FAILED_LOGINS; i++) {
      await expect(login(h.db, { email: staff.email, password: "nope nope nope" }, now)).rejects.toThrow();
    }
    await expect(login(h.db, { email: staff.email, password: PASSWORD }, now)).rejects.toThrow(LOGIN_FAILED_MESSAGE);
    const later = new Date(now.getTime() + LOCKOUT_MS + 1000);
    await expect(login(h.db, { email: staff.email, password: PASSWORD }, later)).resolves.toBeTruthy();
  });

  it("never writes the password into the audit log", async () => {
    const staff = await createUser(h.db, { role: "preparer", password: PASSWORD });
    await login(h.db, { email: staff.email, password: "a-wrong-secret-value" }).catch(() => {});
    await login(h.db, { email: staff.email, password: PASSWORD });
    const events = await h.db.select().from(auditEvents).where(eq(auditEvents.actorUserId, staff.userId));
    const dump = JSON.stringify(events);
    expect(dump).not.toContain(PASSWORD);
    expect(dump).not.toContain("a-wrong-secret-value");
    expect(events.map((e) => e.action)).toEqual(expect.arrayContaining(["auth.login_failed", "auth.login"]));
  });
});

describe("sessions", () => {
  it("validates, slides and expires sessions", async () => {
    const staff = await createUser(h.db, { role: "admin", password: PASSWORD });
    const t0 = new Date("2026-11-11T09:00:00Z");
    const { token } = await createSession(h.db, staff.userId, t0);

    expect((await validateSessionToken(h.db, token, t0))?.userId).toBe(staff.userId);
    expect(await validateSessionToken(h.db, "not-a-real-token", t0)).toBeNull();

    // Idle past the window → expired and deleted.
    const idle = new Date(t0.getTime() + SESSION_IDLE_MS + 1);
    expect(await validateSessionToken(h.db, token, idle)).toBeNull();
    expect(await h.db.select().from(sessions).where(eq(sessions.id, hashToken(token)))).toHaveLength(0);
  });

  it("enforces the absolute lifetime even with continuous activity", async () => {
    const staff = await createUser(h.db, { role: "admin", password: PASSWORD });
    const t0 = new Date("2026-11-11T09:00:00Z");
    const { token } = await createSession(h.db, staff.userId, t0);
    for (let t = t0.getTime(); t < t0.getTime() + SESSION_ABSOLUTE_MS; t += SESSION_IDLE_MS / 3) {
      expect(await validateSessionToken(h.db, token, new Date(t))).not.toBeNull();
    }
    expect(await validateSessionToken(h.db, token, new Date(t0.getTime() + SESSION_ABSOLUTE_MS + 1))).toBeNull();
  });

  it("rejects sessions of deactivated users and supports sign-out", async () => {
    const a = await createUser(h.db, { role: "preparer", password: PASSWORD });
    const s1 = await createSession(h.db, a.userId);
    await invalidateSession(h.db, s1.token);
    expect(await validateSessionToken(h.db, s1.token)).toBeNull();

    const s2 = await createSession(h.db, a.userId);
    await deactivate(h.db, a.userId);
    expect(await validateSessionToken(h.db, s2.token)).toBeNull();
  });
});

describe("invitations", () => {
  it("lets an invited user set a password once, then sign in", async () => {
    const { token, userId } = await createStaffInvitation(
      h.db,
      await defaultFirmId(h.db),
      { email: "New.Preparer@Example.test", name: "New Preparer", role: "preparer" },
      null,
    );
    const stored = await h.db.select().from(invitations).where(eq(invitations.userId, userId));
    expect(stored[0]!.id).toBe(hashToken(token));

    await acceptInvitation(h.db, token, PASSWORD);
    await expect(acceptInvitation(h.db, token, PASSWORD)).rejects.toBeInstanceOf(InvalidInvitationError);
    const result = await login(h.db, { email: "new.preparer@example.test", password: PASSWORD });
    expect(result.actor.role).toBe("preparer");

    const [user] = await h.db.select().from(users).where(eq(users.id, userId));
    expect(user!.passwordHash).toMatch(/^\$argon2id\$/);
  });

  it("rejects expired invitations and weak passwords", async () => {
    const { token } = await createStaffInvitation(h.db, await defaultFirmId(h.db), { email: "late@example.test", name: "Late", role: "preparer" }, null);
    await expect(acceptInvitation(h.db, token, "short")).rejects.toBeInstanceOf(ValidationError);
    const later = new Date(Date.now() + INVITATION_TTL_MS + 1000);
    await expect(acceptInvitation(h.db, token, PASSWORD, later)).rejects.toBeInstanceOf(InvalidInvitationError);
  });

  it("only admins may invite staff", async () => {
    const preparer = await createUser(h.db, { role: "preparer" });
    await expect(
      createStaffInvitation(h.db, preparer.firmId, { email: "x@example.test", name: "X", role: "admin" }, preparer),
    ).rejects.toThrow("permission");
  });
});
