import { and, asc, eq, max, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { auditEvents, clients, portalClientAccess, users } from "@/db/schema";
import type { Actor } from "@/lib/auth/actor";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { isUuid } from "@/lib/validation";
import { assertClientAccess, inFirm, requirePermission, visibleClientsCondition } from "./access";
import { recordAudit } from "./audit";

/**
 * Portal authorization. A portal user may act for every client listed for them in
 * portal_client_access with status "active" — and nothing else. The browser may SUGGEST
 * which of those clients to show (e.g. a switcher cookie), but every request re-resolves
 * the list on the server; a client id that isn't in it behaves like one that doesn't exist.
 */

export interface PortalClient {
  clientId: string;
  name: string;
  role: "owner" | "contact" | "viewer";
}

/** All active clients this portal user may access, in their firm. */
export async function listPortalClients(db: Db, actor: Actor): Promise<PortalClient[]> {
  if (actor.role !== "client") throw new ForbiddenError();
  return db
    .select({ clientId: portalClientAccess.clientId, name: clients.displayName, role: portalClientAccess.role })
    .from(portalClientAccess)
    .innerJoin(clients, and(eq(clients.id, portalClientAccess.clientId), eq(clients.firmId, portalClientAccess.firmId)))
    .where(and(inFirm(portalClientAccess.firmId, actor), eq(portalClientAccess.userId, actor.userId), eq(portalClientAccess.status, "active")))
    .orderBy(asc(clients.displayName));
}

/**
 * The client this request acts for. `requested` is only a hint (from the switcher);
 * it must be one of the user's active clients, otherwise the user's first client is used.
 * Throws if the user has no active client access at all.
 */
export async function resolvePortalClient(db: Db, actor: Actor, requested?: string | null): Promise<PortalClient> {
  const list = await listPortalClients(db, actor);
  if (!list.length) throw new ForbiddenError("Your portal access isn’t active. Please contact the firm.");
  if (requested && isUuid(requested)) {
    const match = list.find((c) => c.clientId === requested);
    if (match) return match;
  }
  // Prefer the client the login was created for, if still active.
  return list.find((c) => c.clientId === actor.clientId) ?? list[0]!;
}

/** Throws NotFound unless this portal user may access `clientId` (use for any id from a URL/payload). */
export async function assertPortalClientAccess(db: Db, actor: Actor, clientId: string): Promise<PortalClient> {
  if (!isUuid(clientId)) throw new NotFoundError();
  const match = (await listPortalClients(db, actor)).find((c) => c.clientId === clientId);
  if (!match) throw new NotFoundError();
  return match;
}

/* ───────── Staff management of portal access (/staff/client-portal) ───────── */

export interface PortalAccessRow {
  userId: string;
  userName: string;
  email: string;
  isActive: boolean;
  hasPassword: boolean;
  clientId: string;
  clientName: string;
  role: PortalClient["role"];
  status: "active" | "suspended";
  lastSignIn: Date | null;
}

/** One row per (portal user × client), limited to clients the staff member can see. */
export async function listPortalAccess(db: Db, actor: Actor, clientId?: string): Promise<PortalAccessRow[]> {
  requirePermission(actor, "client_portal", "view");
  if (clientId) await assertClientAccess(db, actor, clientId);
  const lastLogin = db
    .select({ userId: auditEvents.actorUserId, at: max(auditEvents.createdAt).as("at") })
    .from(auditEvents)
    .where(and(inFirm(auditEvents.firmId, actor), eq(auditEvents.action, "auth.login")))
    .groupBy(auditEvents.actorUserId)
    .as("last_login");
  const rows = await db
    .select({
      userId: users.id,
      userName: users.name,
      email: users.email,
      isActive: users.isActive,
      hasPassword: sqlHasPassword(),
      clientId: clients.id,
      clientName: clients.displayName,
      role: portalClientAccess.role,
      status: portalClientAccess.status,
      lastSignIn: lastLogin.at,
    })
    .from(portalClientAccess)
    .innerJoin(users, and(eq(users.id, portalClientAccess.userId), eq(users.firmId, portalClientAccess.firmId)))
    .innerJoin(clients, and(eq(clients.id, portalClientAccess.clientId), eq(clients.firmId, portalClientAccess.firmId)))
    .leftJoin(lastLogin, eq(lastLogin.userId, users.id))
    .where(and(inFirm(portalClientAccess.firmId, actor), visibleClientsCondition(db, actor), clientId ? eq(portalClientAccess.clientId, clientId) : undefined))
    .orderBy(asc(clients.displayName), asc(users.name));
  return rows.map((r) => ({ ...r, lastSignIn: r.lastSignIn ? new Date(r.lastSignIn) : null }));
}

/** Portal accounts of the firm whose clients the staff member can see (for "grant access to another client"). */
export async function listPortalUsersForGrant(db: Db, actor: Actor): Promise<{ userId: string; name: string; email: string }[]> {
  const rows = await listPortalAccess(db, actor);
  return [...new Map(rows.map((r) => [r.userId, { userId: r.userId, name: r.userName, email: r.email }])).values()];
}

function sqlHasPassword() {
  // Never return the hash itself — only whether one exists.
  return sql<boolean>`${users.passwordHash} is not null`;
}

/** Grants an existing portal user access to another client of the same firm (e.g. a bookkeeper for two businesses). */
export async function grantPortalAccess(db: Db, actor: Actor, input: { userId: string; clientId: string; role?: PortalClient["role"] }): Promise<void> {
  requirePermission(actor, "client_portal", "manage_access");
  await assertClientAccess(db, actor, input.clientId);
  if (!isUuid(input.userId)) throw new NotFoundError();
  const [user] = await db.select({ role: users.role }).from(users).where(and(eq(users.id, input.userId), inFirm(users.firmId, actor)));
  if (!user) throw new NotFoundError();
  // Portal access is never granted to staff accounts (and staff permissions never to portal users).
  if (user.role !== "client") throw new ValidationError({ userId: ["Only client portal accounts can be given portal access."] });
  await db
    .insert(portalClientAccess)
    .values({ firmId: actor.firmId, userId: input.userId, clientId: input.clientId, role: input.role ?? "contact", status: "active", grantedById: actor.userId })
    .onConflictDoUpdate({ target: [portalClientAccess.userId, portalClientAccess.clientId], set: { status: "active", role: input.role ?? "contact", updatedAt: new Date() } });
  await recordAudit(db, { firmId: actor.firmId, actorUserId: actor.userId, action: "portal.grant", entityType: "client", entityId: input.clientId, metadata: { userId: input.userId } });
}

/** Suspends or restores one portal user's access to one client (other clients unaffected). */
export async function setPortalAccessStatus(db: Db, actor: Actor, input: { userId: string; clientId: string; status: "active" | "suspended" }): Promise<void> {
  requirePermission(actor, "client_portal", "suspend_access");
  await assertClientAccess(db, actor, input.clientId);
  if (!isUuid(input.userId)) throw new NotFoundError();
  const [row] = await db
    .update(portalClientAccess)
    .set({ status: input.status, updatedAt: new Date() })
    .where(and(inFirm(portalClientAccess.firmId, actor), eq(portalClientAccess.userId, input.userId), eq(portalClientAccess.clientId, input.clientId)))
    .returning({ userId: portalClientAccess.userId });
  if (!row) throw new NotFoundError();
  await recordAudit(db, { firmId: actor.firmId, actorUserId: actor.userId, action: input.status === "suspended" ? "portal.suspend" : "portal.restore", entityType: "client", entityId: input.clientId, metadata: { userId: input.userId } });
}
