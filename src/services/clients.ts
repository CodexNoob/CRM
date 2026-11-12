import { and, asc, eq, ilike, or } from "drizzle-orm";
import type { Db } from "@/db";
import { clients, type Client } from "@/db/schema";
import type { Actor } from "@/lib/auth/actor";
import { NotFoundError } from "@/lib/errors";
import { clientInputSchema, clientSearchSchema, parseInput } from "@/lib/validation";
import { recordAudit } from "./audit";
import { assertClientAccess, ensureAssignment, requireStaff, visibleClientsCondition } from "./access";

export const CLIENT_LIST_LIMIT = 100;

/** Escapes LIKE wildcards so user input is matched literally. */
function likeContains(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export async function listClients(db: Db, actor: Actor, params: { q?: unknown } = {}): Promise<Client[]> {
  const { q } = parseInput(clientSearchSchema, params);
  const visible = visibleClientsCondition(db, actor);
  const search = q
    ? or(ilike(clients.displayName, likeContains(q)), ilike(clients.email, likeContains(q)), ilike(clients.phone, likeContains(q)))
    : undefined;
  return db
    .select()
    .from(clients)
    .where(and(visible, search))
    .orderBy(asc(clients.displayName))
    .limit(CLIENT_LIST_LIMIT);
}

export async function getClient(db: Db, actor: Actor, clientId: string): Promise<Client> {
  await assertClientAccess(db, actor, clientId);
  const [client] = await db.select().from(clients).where(eq(clients.id, clientId)).limit(1);
  if (!client) throw new NotFoundError();
  return client;
}

export async function createClient(db: Db, actor: Actor, input: unknown): Promise<Client> {
  requireStaff(actor);
  const data = parseInput(clientInputSchema, input);
  return db.transaction(async (tx) => {
    const [client] = await tx
      .insert(clients)
      .values({ ...data, email: data.email ?? null, phone: data.phone ?? null, createdById: actor.userId })
      .returning();
    if (!client) throw new Error("Insert returned no row");
    // The creator can always see what they created.
    await ensureAssignment(tx as unknown as Db, client.id, actor.userId);
    await recordAudit(tx as unknown as Db, {
      actorUserId: actor.userId,
      action: "client.create",
      entityType: "client",
      entityId: client.id,
    });
    await recordAudit(tx as unknown as Db, {
      actorUserId: actor.userId,
      action: "client.assign",
      entityType: "client",
      entityId: client.id,
      metadata: { userId: actor.userId, reason: "creator_access" },
    });
    return client;
  });
}

export async function updateClient(db: Db, actor: Actor, clientId: string, input: unknown): Promise<Client> {
  const existing = await getClient(db, actor, clientId);
  const data = parseInput(clientInputSchema, input);
  const next = { ...data, email: data.email ?? null, phone: data.phone ?? null };
  const changed = (Object.keys(next) as (keyof typeof next)[]).filter((k) => next[k] !== existing[k]);
  if (changed.length === 0) return existing;

  const [updated] = await db
    .update(clients)
    .set({ ...next, updatedAt: new Date() })
    .where(eq(clients.id, clientId))
    .returning();
  if (!updated) throw new NotFoundError();
  await recordAudit(db, {
    actorUserId: actor.userId,
    action: "client.update",
    entityType: "client",
    entityId: clientId,
    metadata: { changedFields: changed },
  });
  return updated;
}
