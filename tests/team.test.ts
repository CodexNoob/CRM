import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { openDatabase, type DbHandle } from "@/db";
import { users } from "@/db/schema";
import { login } from "@/lib/auth/login";
import { createSession, validateSessionToken } from "@/lib/auth/sessions";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { createFirstAdmin, hasAnyUsers, SetupUnavailableError } from "@/services/setup";
import { changeStaffRole, inviteStaff, listTeam, sendStaffSignInLink, setStaffActive } from "@/services/team";
import { acceptInvitation } from "@/services/users";
import { createTestDb, createUser } from "./helpers";

const PASSWORD = "correct horse battery staple";
const CODE = "a-very-long-random-setup-code-1234567890";

describe("team management", () => {
  let h: DbHandle;
  beforeAll(async () => {
    h = await createTestDb();
  });
  afterAll(async () => {
    await h.close();
  });

  it("is admin-only for every operation", async () => {
    const admin = await createUser(h.db, { role: "admin" });
    for (const role of ["manager", "employee", "client"] as const) {
      const actor = await createUser(h.db, { role });
      await expect(listTeam(h.db, actor)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(inviteStaff(h.db, actor, { name: "X", email: `x-${role}@example.test`, role: "admin" })).rejects.toBeInstanceOf(ForbiddenError);
      await expect(sendStaffSignInLink(h.db, actor, admin.userId)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(setStaffActive(h.db, actor, admin.userId, false)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(changeStaffRole(h.db, actor, admin.userId, "employee")).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it("invites staff who can then set a password and sign in", async () => {
    const admin = await createUser(h.db, { role: "admin" });
    const { token } = await inviteStaff(h.db, admin, { name: "Pat New", email: "Pat.New@Example.test", role: "employee" });
    expect((await listTeam(h.db, admin)).find((m) => m.email === "pat.new@example.test")).toMatchObject({ role: "employee", hasPassword: false });
    await acceptInvitation(h.db, token, PASSWORD);
    expect((await login(h.db, { email: "pat.new@example.test", password: PASSWORD })).actor.role).toBe("employee");

    const dup = await inviteStaff(h.db, admin, { name: "Again", email: "pat.new@example.test", role: "admin" }).catch((e) => e);
    expect(dup).toBeInstanceOf(ValidationError);
    const bad = await inviteStaff(h.db, admin, { name: "", email: "nope", role: "client" }).catch((e) => e);
    expect(Object.keys((bad as ValidationError).fieldErrors).sort()).toEqual(["email", "name", "role"]);
  });

  it("cannot be used to manage client portal logins", async () => {
    const admin = await createUser(h.db, { role: "admin" });
    const portal = await createUser(h.db, { role: "client" });
    await expect(setStaffActive(h.db, admin, portal.userId, false)).rejects.toBeInstanceOf(NotFoundError);
    await expect(changeStaffRole(h.db, admin, portal.userId, "admin")).rejects.toBeInstanceOf(NotFoundError);
    await expect(sendStaffSignInLink(h.db, admin, portal.userId)).rejects.toBeInstanceOf(NotFoundError);
    expect((await listTeam(h.db, admin)).some((m) => m.id === portal.userId)).toBe(false);
  });

  it("deactivation signs the person out and blocks sign-in until reactivated", async () => {
    const admin = await createUser(h.db, { role: "admin" });
    const staff = await createUser(h.db, { role: "employee", password: PASSWORD });
    const { token } = await createSession(h.db, staff.userId);
    await setStaffActive(h.db, admin, staff.userId, false);
    expect(await validateSessionToken(h.db, token)).toBeNull();
    await expect(login(h.db, { email: staff.email, password: PASSWORD })).rejects.toThrow();
    await expect(sendStaffSignInLink(h.db, admin, staff.userId)).rejects.toBeInstanceOf(ValidationError);
    await setStaffActive(h.db, admin, staff.userId, true);
    await expect(login(h.db, { email: staff.email, password: PASSWORD })).resolves.toBeTruthy();
  });

  it("protects the admin's own account and the last admin", async () => {
    const h2 = await createTestDb();
    try {
      const soleAdmin = await createUser(h2.db, { role: "admin" });
      await expect(setStaffActive(h2.db, soleAdmin, soleAdmin.userId, false)).rejects.toBeInstanceOf(ValidationError);
      await expect(changeStaffRole(h2.db, soleAdmin, soleAdmin.userId, "employee")).rejects.toBeInstanceOf(ValidationError);

      const second = await createUser(h2.db, { role: "admin" });
      // With two admins, one may demote the other — leaving exactly one.
      await changeStaffRole(h2.db, soleAdmin, second.userId, "manager");
      // The remaining admin cannot be removed by a (now non-admin) colleague either.
      await expect(setStaffActive(h2.db, { ...second, role: "manager" }, soleAdmin.userId, false)).rejects.toBeInstanceOf(ForbiddenError);
    } finally {
      await h2.close();
    }
  });

  it("role changes take effect immediately by ending existing sessions", async () => {
    const admin = await createUser(h.db, { role: "admin" });
    const staff = await createUser(h.db, { role: "manager", password: PASSWORD });
    const { token } = await createSession(h.db, staff.userId);
    await changeStaffRole(h.db, admin, staff.userId, "employee");
    expect(await validateSessionToken(h.db, token)).toBeNull();
    const [row] = await h.db.select().from(users).where(eq(users.id, staff.userId));
    expect(row!.role).toBe("employee");
  });
});

describe("first-run setup", () => {
  it("creates exactly one first admin, only with the right code", async () => {
    const h = openDatabase("pglite:memory");
    await h.migrate();
    try {
      expect(await hasAnyUsers(h.db)).toBe(false);
      const form = { name: "Owner", email: "Owner@Firm.test", password: PASSWORD, confirmPassword: PASSWORD, setupCode: CODE };

      await expect(createFirstAdmin(h.db, form, undefined)).rejects.toThrow(/not enabled/);
      await expect(createFirstAdmin(h.db, form, "short")).rejects.toThrow(/not enabled/);
      const wrong = await createFirstAdmin(h.db, { ...form, setupCode: "wrong" }, CODE).catch((e) => e);
      expect((wrong as ValidationError).fieldErrors.setupCode).toBeTruthy();
      const mismatch = await createFirstAdmin(h.db, { ...form, confirmPassword: "different password!" }, CODE).catch((e) => e);
      expect((mismatch as ValidationError).fieldErrors.confirmPassword).toBeTruthy();
      expect(await hasAnyUsers(h.db)).toBe(false);

      const actor = await createFirstAdmin(h.db, form, CODE);
      expect(actor.role).toBe("admin");
      expect((await login(h.db, { email: "owner@firm.test", password: PASSWORD })).actor.userId).toBe(actor.userId);

      await expect(createFirstAdmin(h.db, { ...form, email: "attacker@evil.test" }, CODE)).rejects.toBeInstanceOf(SetupUnavailableError);
    } finally {
      await h.close();
    }
  });
});
