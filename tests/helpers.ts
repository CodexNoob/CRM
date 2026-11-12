import { eq } from "drizzle-orm";
import { openDatabase, type Db, type DbHandle } from "@/db";
import { portalClientAccess, users, type UserRole } from "@/db/schema";
import { actorFromUser, type Actor } from "@/lib/auth/actor";
import { hashPassword } from "@/lib/auth/crypto";
import { createClient } from "@/services/clients";
import { createFirm } from "@/services/firms";

/** A fresh, migrated, in-memory Postgres (PGlite) per test file. */
export async function createTestDb(): Promise<DbHandle> {
  const handle = openDatabase("pglite:memory");
  await handle.migrate();
  return handle;
}

/** Each test database gets one default firm, used whenever a test doesn't name a firm. */
const defaultFirms = new WeakMap<Db, Promise<string>>();

export function defaultFirmId(db: Db): Promise<string> {
  let id = defaultFirms.get(db);
  if (!id) {
    id = createFirm(db, { name: "Test Firm", status: "active" }).then((f) => f.id);
    defaultFirms.set(db, id);
  }
  return id;
}

/** Creates an additional firm (tenant) for isolation tests. */
export async function createTestFirm(db: Db, name = "Other Firm"): Promise<string> {
  return (await createFirm(db, { name, status: "active" })).id;
}

let counter = 0;

export async function createUser(
  db: Db,
  opts: { role: UserRole; clientId?: string; password?: string; name?: string; isActive?: boolean; firmId?: string },
): Promise<Actor> {
  counter += 1;
  const email = `user${counter}-${Date.now()}@example.test`;
  const name = opts.name ?? `${opts.role} ${counter}`;
  const [user] = await db
    .insert(users)
    .values({
      firmId: opts.firmId ?? (await defaultFirmId(db)),
      email,
      name,
      role: opts.role,
      clientId: opts.clientId ?? null,
      passwordHash: opts.password ? await hashPassword(opts.password) : null,
      isActive: opts.isActive ?? true,
    })
    .returning();
  if (!user) throw new Error("no user");
  // Portal logins act for clients listed in portal_client_access (as the invitation flow records).
  if (user.role === "client" && user.clientId) {
    await db.insert(portalClientAccess).values({ firmId: user.firmId, userId: user.id, clientId: user.clientId, role: "owner", status: "active" }).onConflictDoNothing();
  }
  return actorFromUser(user);
}

export async function deactivate(db: Db, userId: string) {
  await db.update(users).set({ isActive: false }).where(eq(users.id, userId));
}

/** Creates a client record (as `staff`, in staff's firm) plus a portal user for it. */
export async function createClientWithPortalUser(db: Db, staff: Actor, displayName: string) {
  const client = await createClient(db, staff, { type: "individual", displayName });
  const portalUser = await createUser(db, { role: "client", clientId: client.id, firmId: staff.firmId });
  return { client, portalUser };
}
