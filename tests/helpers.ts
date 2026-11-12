import { eq } from "drizzle-orm";
import { openDatabase, type Db, type DbHandle } from "@/db";
import { users, type UserRole } from "@/db/schema";
import type { Actor } from "@/lib/auth/actor";
import { hashPassword } from "@/lib/auth/crypto";
import { createClient } from "@/services/clients";

/** A fresh, migrated, in-memory Postgres (PGlite) per test file. */
export async function createTestDb(): Promise<DbHandle> {
  const handle = openDatabase("pglite:memory");
  await handle.migrate();
  return handle;
}

let counter = 0;

export async function createUser(
  db: Db,
  opts: { role: UserRole; clientId?: string; password?: string; name?: string; isActive?: boolean },
): Promise<Actor> {
  counter += 1;
  const email = `user${counter}-${Date.now()}@example.test`;
  const name = opts.name ?? `${opts.role} ${counter}`;
  const [user] = await db
    .insert(users)
    .values({
      email,
      name,
      role: opts.role,
      clientId: opts.clientId ?? null,
      passwordHash: opts.password ? await hashPassword(opts.password) : null,
      isActive: opts.isActive ?? true,
    })
    .returning();
  if (!user) throw new Error("no user");
  return { userId: user.id, role: user.role, clientId: user.clientId, name: user.name, email: user.email };
}

export async function deactivate(db: Db, userId: string) {
  await db.update(users).set({ isActive: false }).where(eq(users.id, userId));
}

/** Creates a client record (as `staff`) plus a portal user for it. */
export async function createClientWithPortalUser(db: Db, staff: Actor, displayName: string) {
  const client = await createClient(db, staff, { type: "individual", displayName });
  const portalUser = await createUser(db, { role: "client", clientId: client.id });
  return { client, portalUser };
}
