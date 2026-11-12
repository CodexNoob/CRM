import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { clientNotifications, portalClientAccess } from "@/db/schema";
import type { Actor } from "@/lib/auth/actor";
import { ForbiddenError } from "@/lib/errors";
import { isUuid } from "@/lib/validation";

/**
 * In-app notifications for portal users. These appear in the portal only — they do
 * NOT mean an email or text was sent (no email is sent unless a provider confirms it).
 * Each notification has a dedupe key, so retries and double clicks never duplicate it.
 */

export type ClientNotificationType = "message" | "document_request" | "document_shared" | "document_review" | "signature_request" | "invoice";

/** Notifies every active portal user of `clientId` (in `firmId`). Idempotent per (user, dedupeKey). */
export async function notifyClientUsers(
  db: Db,
  firmId: string,
  clientId: string,
  n: { type: ClientNotificationType; title: string; href?: string; dedupeKey: string; exceptUserId?: string | null },
): Promise<number> {
  const recipients = await db
    .select({ userId: portalClientAccess.userId })
    .from(portalClientAccess)
    .where(and(eq(portalClientAccess.firmId, firmId), eq(portalClientAccess.clientId, clientId), eq(portalClientAccess.status, "active")));
  const rows = recipients
    .filter((r) => r.userId !== n.exceptUserId)
    .map((r) => ({ firmId, clientId, userId: r.userId, type: n.type, title: n.title.slice(0, 300), href: n.href ?? null, dedupeKey: n.dedupeKey.slice(0, 200) }));
  if (!rows.length) return 0;
  const inserted = await db.insert(clientNotifications).values(rows).onConflictDoNothing().returning({ id: clientNotifications.id });
  return inserted.length;
}

export interface PortalNotification {
  id: string;
  type: string;
  title: string;
  href: string | null;
  readAt: Date | null;
  createdAt: Date;
}

/** The signed-in portal user's notifications for the client they're viewing. */
export async function listPortalNotifications(db: Db, actor: Actor, clientId: string, limit = 30): Promise<PortalNotification[]> {
  if (actor.role !== "client") throw new ForbiddenError();
  return db
    .select({ id: clientNotifications.id, type: clientNotifications.type, title: clientNotifications.title, href: clientNotifications.href, readAt: clientNotifications.readAt, createdAt: clientNotifications.createdAt })
    .from(clientNotifications)
    .where(and(eq(clientNotifications.firmId, actor.firmId), eq(clientNotifications.userId, actor.userId), eq(clientNotifications.clientId, clientId)))
    .orderBy(desc(clientNotifications.createdAt))
    .limit(limit);
}

export async function countUnreadPortalNotifications(db: Db, actor: Actor, clientId: string): Promise<number> {
  if (actor.role !== "client") return 0;
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(clientNotifications)
    .where(and(eq(clientNotifications.firmId, actor.firmId), eq(clientNotifications.userId, actor.userId), eq(clientNotifications.clientId, clientId), isNull(clientNotifications.readAt)));
  return row?.n ?? 0;
}

/** Marks the user's own notifications read (ids from the browser are filtered to the user's own rows). */
export async function markPortalNotificationsRead(db: Db, actor: Actor, ids: string[] | "all", clientId: string): Promise<void> {
  if (actor.role !== "client") throw new ForbiddenError();
  const valid = ids === "all" ? null : ids.filter(isUuid).slice(0, 200);
  if (valid && !valid.length) return;
  await db
    .update(clientNotifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(clientNotifications.firmId, actor.firmId),
        eq(clientNotifications.userId, actor.userId),
        eq(clientNotifications.clientId, clientId),
        isNull(clientNotifications.readAt),
        valid ? inArray(clientNotifications.id, valid) : undefined,
      ),
    );
}
