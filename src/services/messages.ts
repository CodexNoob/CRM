import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { clients, messages, users } from "@/db/schema";
import type { Actor } from "@/lib/auth/actor";
import { ForbiddenError } from "@/lib/errors";
import { messageBodySchema, parseInput } from "@/lib/validation";
import { assertClientAccess, requireStaff, visibleClientsCondition } from "./access";
import { recordAudit } from "./audit";

/**
 * One secure conversation per client. Message bodies are never emailed or
 * logged; the audit trail records only that a message was sent.
 */

async function resolveThreadClient(db: Db, actor: Actor, clientId?: string): Promise<string> {
  if (actor.role === "client") {
    if (!actor.clientId) throw new ForbiddenError();
    return actor.clientId;
  }
  if (!clientId) throw new ForbiddenError();
  await assertClientAccess(db, actor, clientId);
  return clientId;
}

export async function sendMessage(db: Db, actor: Actor, body: unknown, clientId?: string) {
  const threadClientId = await resolveThreadClient(db, actor, clientId);
  const text = parseInput(messageBodySchema, body);
  const [msg] = await db
    .insert(messages)
    .values({ clientId: threadClientId, authorId: actor.userId, fromClient: actor.role === "client", body: text })
    .returning();
  await recordAudit(db, { actorUserId: actor.userId, action: "message.send", entityType: "client", entityId: threadClientId });
  return msg!;
}

export interface ThreadMessage {
  id: string;
  body: string;
  fromClient: boolean;
  authorName: string | null;
  createdAt: Date;
  mine: boolean;
}

/** Returns the conversation and marks the other side's messages as read. */
export async function getThread(db: Db, actor: Actor, clientId?: string): Promise<ThreadMessage[]> {
  const threadClientId = await resolveThreadClient(db, actor, clientId);
  const readerIsClient = actor.role === "client";
  await db
    .update(messages)
    .set({ readAt: new Date() })
    .where(and(eq(messages.clientId, threadClientId), eq(messages.fromClient, !readerIsClient), isNull(messages.readAt)));
  const rows = await db
    .select({ id: messages.id, body: messages.body, fromClient: messages.fromClient, authorName: users.name, authorId: messages.authorId, createdAt: messages.createdAt })
    .from(messages)
    .leftJoin(users, eq(users.id, messages.authorId))
    .where(eq(messages.clientId, threadClientId))
    .orderBy(asc(messages.createdAt))
    .limit(500);
  return rows.map(({ authorId, ...r }) => ({ ...r, mine: authorId === actor.userId }));
}

export interface ConversationSummary {
  clientId: string;
  clientName: string;
  lastBody: string;
  lastFromClient: boolean;
  lastAt: Date;
  unread: number;
}

/** Staff inbox: one row per client with messages, newest first. */
export async function listConversations(db: Db, actor: Actor): Promise<ConversationSummary[]> {
  const visible = visibleClientsCondition(db, actor);
  const latest = db
    .selectDistinctOn([messages.clientId], {
      clientId: messages.clientId,
      body: messages.body,
      fromClient: messages.fromClient,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .orderBy(messages.clientId, desc(messages.createdAt))
    .as("latest");
  const rows = await db
    .select({
      clientId: clients.id,
      clientName: clients.displayName,
      lastBody: latest.body,
      lastFromClient: latest.fromClient,
      lastAt: latest.createdAt,
      unread: sql<number>`(select count(*)::int from ${messages} m where m.client_id = ${clients.id} and m.from_client and m.read_at is null)`,
    })
    .from(latest)
    .innerJoin(clients, eq(clients.id, latest.clientId))
    .where(visible)
    .orderBy(desc(latest.createdAt))
    .limit(200);
  return rows;
}

export async function countUnreadForStaff(db: Db, actor: Actor): Promise<number> {
  requireStaff(actor);
  const visible = visibleClientsCondition(db, actor);
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(messages)
    .innerJoin(clients, eq(clients.id, messages.clientId))
    .where(and(visible, eq(messages.fromClient, true), isNull(messages.readAt)));
  return row?.n ?? 0;
}

export async function countUnreadForClient(db: Db, actor: Actor): Promise<number> {
  if (actor.role !== "client" || !actor.clientId) throw new ForbiddenError();
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(messages)
    .where(and(eq(messages.clientId, actor.clientId), eq(messages.fromClient, false), isNull(messages.readAt)));
  return row?.n ?? 0;
}
