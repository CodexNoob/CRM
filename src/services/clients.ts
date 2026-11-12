import { and, asc, eq, ilike, isNull, ne, or, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { clientContacts, clients, onboardingItems, type Client, type ClientStatus, type OnboardingStatus } from "@/db/schema";
import type { Actor } from "@/lib/auth/actor";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { clientDetailsSchema, clientSearchSchema, contactInputSchema, isUuid, onboardingItemSchema, parseInput } from "@/lib/validation";
import { recordAudit } from "./audit";
import { assertActiveStaffUser, assertClientAccess, ensureAssignment, inFirm, requirePermission, requireStaff, visibleClientsCondition } from "./access";
import { logActivity, nextNumber, recordStatusChange } from "./timeline";

/**
 * Clients: the firm's official customers. A client is created directly or by converting a
 * lead; it starts in onboarding (never "fully onboarded" just because a record exists),
 * may have several contacts (business clients), and is archived rather than deleted.
 */

export const CLIENT_LIST_LIMIT = 100;

function likeContains(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export async function listClients(db: Db, actor: Actor, params: { q?: unknown; includeArchived?: boolean } = {}): Promise<Client[]> {
  const { q } = parseInput(clientSearchSchema, { q: params.q });
  const visible = visibleClientsCondition(db, actor);
  const search = q ? or(ilike(clients.displayName, likeContains(q)), ilike(clients.email, likeContains(q)), ilike(clients.phone, likeContains(q))) : undefined;
  return db
    .select()
    .from(clients)
    .where(and(inFirm(clients.firmId, actor), visible, search, params.includeArchived ? undefined : isNull(clients.archivedAt)))
    .orderBy(asc(clients.displayName))
    .limit(CLIENT_LIST_LIMIT);
}

/** Every visible, non-archived client as id/name (pickers such as "link lead to existing client"). */
export async function listClientOptions(db: Db, actor: Actor): Promise<{ id: string; name: string; clientNumber: number | null }[]> {
  const visible = visibleClientsCondition(db, actor);
  return db
    .select({ id: clients.id, name: clients.displayName, clientNumber: clients.clientNumber })
    .from(clients)
    .where(and(inFirm(clients.firmId, actor), visible, isNull(clients.archivedAt)))
    .orderBy(asc(clients.displayName))
    .limit(5000);
}

export async function getClient(db: Db, actor: Actor, clientId: string): Promise<Client> {
  await assertClientAccess(db, actor, clientId);
  const [client] = await db.select().from(clients).where(and(eq(clients.id, clientId), inFirm(clients.firmId, actor))).limit(1);
  if (!client) throw new NotFoundError();
  return client;
}

/** Internal fields set by lead conversion, not by the form. */
export interface CreateClientOptions {
  sourceLeadId?: string;
}

export async function createClient(db: Db, actor: Actor, input: unknown, opts: CreateClientOptions = {}): Promise<Client> {
  requirePermission(actor, "clients", "create");
  const data = parseInput(clientDetailsSchema, input);
  if (data.accountManagerId) await assertActiveStaffUser(db, actor, data.accountManagerId, "accountManagerId");
  return db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Db;
    const [client] = await tx
      .insert(clients)
      .values({
        firmId: actor.firmId,
        type: data.type,
        displayName: data.displayName,
        firstName: data.firstName ?? null,
        lastName: data.lastName ?? null,
        email: data.email ?? null,
        phone: data.phone ?? null,
        address: data.address ?? null,
        status: data.status,
        onboardingStatus: "not_started",
        accountManagerId: data.accountManagerId ?? null,
        notes: data.notes ?? null,
        sourceLeadId: opts.sourceLeadId ?? null,
        clientNumber: await nextNumber(tx, actor.firmId, "client"),
        createdById: actor.userId,
      })
      .returning();
    if (!client) throw new Error("Insert returned no row");
    // The creator (and the account manager) can always see the client.
    await ensureAssignment(tx, actor.firmId, client.id, actor.userId);
    if (data.accountManagerId) await ensureAssignment(tx, actor.firmId, client.id, data.accountManagerId);
    await recordAudit(tx, { firmId: actor.firmId, actorUserId: actor.userId, action: "client.create", entityType: "client", entityId: client.id });
    await recordAudit(tx, { firmId: actor.firmId, actorUserId: actor.userId, action: "client.assign", entityType: "client", entityId: client.id, metadata: { userId: actor.userId, reason: "creator_access" } });
    await logActivity(tx, actor, { entityType: "client", entityId: client.id, clientId: client.id, type: "system", body: opts.sourceLeadId ? "Client created from a lead" : "Client created" });
    if (data.accountManagerId) {
      await logActivity(tx, actor, { entityType: "client", entityId: client.id, clientId: client.id, type: "assignment", metadata: { role: "account_manager", userId: data.accountManagerId } });
    }
    return client;
  });
}

export async function updateClient(db: Db, actor: Actor, clientId: string, input: unknown): Promise<Client> {
  requirePermission(actor, "clients", "edit");
  const existing = await getClient(db, actor, clientId);
  const data = parseInput(clientDetailsSchema, input);
  if (data.accountManagerId && data.accountManagerId !== existing.accountManagerId) {
    requirePermission(actor, "clients", "assign");
    await assertActiveStaffUser(db, actor, data.accountManagerId, "accountManagerId");
  }
  const next = {
    type: data.type,
    displayName: data.displayName,
    firstName: data.firstName ?? null,
    lastName: data.lastName ?? null,
    email: data.email ?? null,
    phone: data.phone ?? null,
    address: data.address ?? null,
    status: data.status,
    accountManagerId: data.accountManagerId ?? null,
    notes: data.notes ?? null,
  };
  const changed = (Object.keys(next) as (keyof typeof next)[]).filter((k) => next[k] !== existing[k]);
  if (changed.length === 0) return existing;

  return db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Db;
    const [updated] = await tx
      .update(clients)
      .set({ ...next, updatedAt: new Date() })
      .where(and(eq(clients.id, clientId), inFirm(clients.firmId, actor)))
      .returning();
    if (!updated) throw new NotFoundError();
    await recordAudit(tx, { firmId: actor.firmId, actorUserId: actor.userId, action: "client.update", entityType: "client", entityId: clientId, metadata: { changedFields: changed } });
    if (changed.includes("status")) {
      await recordStatusChange(tx, actor, { entityType: "client", entityId: clientId, clientId, from: existing.status, to: next.status });
    }
    if (changed.includes("accountManagerId") && next.accountManagerId) {
      await ensureAssignment(tx, actor.firmId, clientId, next.accountManagerId);
      await logActivity(tx, actor, { entityType: "client", entityId: clientId, clientId, type: "assignment", metadata: { role: "account_manager", userId: next.accountManagerId } });
    }
    const other = changed.filter((k) => k !== "status" && k !== "accountManagerId");
    if (other.length) await logActivity(tx, actor, { entityType: "client", entityId: clientId, clientId, type: "system", body: "Client details updated", metadata: { changedFields: other } });
    return updated;
  });
}

/** Soft-archive (hidden from lists; history, engagements and documents are kept). */
export async function setClientArchived(db: Db, actor: Actor, clientId: string, archived: boolean): Promise<void> {
  requirePermission(actor, "clients", "delete");
  const existing = await getClient(db, actor, clientId);
  if (!!existing.archivedAt === archived) return;
  await db.update(clients).set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() }).where(and(eq(clients.id, clientId), inFirm(clients.firmId, actor)));
  await recordAudit(db, { firmId: actor.firmId, actorUserId: actor.userId, action: archived ? "client.archive" : "client.restore", entityType: "client", entityId: clientId });
  await logActivity(db, actor, { entityType: "client", entityId: clientId, clientId, type: "system", body: archived ? "Client archived" : "Client restored" });
}

export async function setClientStatus(db: Db, actor: Actor, clientId: string, status: ClientStatus): Promise<void> {
  requirePermission(actor, "clients", "edit");
  const existing = await getClient(db, actor, clientId);
  if (existing.status === status) return;
  await db.update(clients).set({ status, updatedAt: new Date() }).where(and(eq(clients.id, clientId), inFirm(clients.firmId, actor)));
  await recordStatusChange(db, actor, { entityType: "client", entityId: clientId, clientId, from: existing.status, to: status });
}

/* ───────── Duplicate detection (used by lead conversion) ───────── */

export interface DuplicateCandidate {
  id: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  clientNumber: number | null;
  reasons: ("email" | "phone" | "name")[];
}

const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

/**
 * Clients in the actor's firm that look like the same person/business: same email
 * (case-insensitive), same phone (last 10 digits), or same name (case/space-insensitive).
 */
export async function findPossibleDuplicates(db: Db, actor: Actor, probe: { name?: string | null; company?: string | null; email?: string | null; phone?: string | null }): Promise<DuplicateCandidate[]> {
  requireStaff(actor);
  const email = probe.email?.trim().toLowerCase() || null;
  const phone = digits(probe.phone).slice(-10) || null;
  const names = [probe.name, probe.company].map((n) => n?.trim().toLowerCase().replace(/\s+/g, " ")).filter((n): n is string => !!n && n.length >= 3);
  const conds = [
    email ? sql`lower(${clients.email}) = ${email}` : undefined,
    phone && phone.length >= 7 ? sql`right(regexp_replace(coalesce(${clients.phone}, ''), '\\D', '', 'g'), 10) = ${phone}` : undefined,
    ...names.map((n) => sql`lower(regexp_replace(${clients.displayName}, '\\s+', ' ', 'g')) = ${n}`),
  ].filter(Boolean);
  if (!conds.length) return [];
  const rows = await db
    .select({ id: clients.id, displayName: clients.displayName, email: clients.email, phone: clients.phone, clientNumber: clients.clientNumber })
    .from(clients)
    .where(and(inFirm(clients.firmId, actor), or(...conds)))
    .limit(10);
  return rows.map((r) => ({
    ...r,
    reasons: [
      ...(email && r.email?.toLowerCase() === email ? (["email"] as const) : []),
      ...(phone && digits(r.phone).slice(-10) === phone ? (["phone"] as const) : []),
      ...(names.includes(r.displayName.trim().toLowerCase().replace(/\s+/g, " ")) ? (["name"] as const) : []),
    ],
  }));
}

/* ───────── Contacts ───────── */

export async function listClientContacts(db: Db, actor: Actor, clientId: string) {
  await assertClientAccess(db, actor, clientId);
  return db
    .select()
    .from(clientContacts)
    .where(and(inFirm(clientContacts.firmId, actor), eq(clientContacts.clientId, clientId), isNull(clientContacts.archivedAt)))
    .orderBy(sql`${clientContacts.isPrimary} desc`, asc(clientContacts.name));
}

export async function saveClientContact(db: Db, actor: Actor, clientId: string, contactId: string | null, input: unknown) {
  requirePermission(actor, "clients", "edit");
  await assertClientAccess(db, actor, clientId);
  const d = parseInput(contactInputSchema, input);
  return db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Db;
    if (d.isPrimary) {
      // Only one primary contact per client.
      await tx.update(clientContacts).set({ isPrimary: false }).where(and(inFirm(clientContacts.firmId, actor), eq(clientContacts.clientId, clientId)));
    }
    const values = { name: d.name, title: d.title ?? null, role: d.role, email: d.email ?? null, phone: d.phone ?? null, isPrimary: d.isPrimary, notes: d.notes ?? null };
    let id = contactId;
    if (contactId) {
      if (!isUuid(contactId)) throw new NotFoundError();
      const [row] = await tx
        .update(clientContacts)
        .set({ ...values, updatedAt: new Date() })
        .where(and(eq(clientContacts.id, contactId), eq(clientContacts.clientId, clientId), inFirm(clientContacts.firmId, actor)))
        .returning({ id: clientContacts.id });
      if (!row) throw new NotFoundError();
    } else {
      const [row] = await tx.insert(clientContacts).values({ ...values, firmId: actor.firmId, clientId }).returning({ id: clientContacts.id });
      id = row!.id;
    }
    await logActivity(tx, actor, { entityType: "client", entityId: clientId, clientId, type: "system", body: `${contactId ? "Updated" : "Added"} contact ${d.name}` });
    return { id: id! };
  });
}

export async function archiveClientContact(db: Db, actor: Actor, clientId: string, contactId: string): Promise<void> {
  requirePermission(actor, "clients", "edit");
  await assertClientAccess(db, actor, clientId);
  if (!isUuid(contactId)) throw new NotFoundError();
  const [row] = await db
    .update(clientContacts)
    .set({ archivedAt: new Date(), isPrimary: false, updatedAt: new Date() })
    .where(and(eq(clientContacts.id, contactId), eq(clientContacts.clientId, clientId), inFirm(clientContacts.firmId, actor)))
    .returning({ name: clientContacts.name });
  if (!row) throw new NotFoundError();
  await logActivity(db, actor, { entityType: "client", entityId: clientId, clientId, type: "system", body: `Removed contact ${row.name}` });
}

/* ───────── Onboarding ───────── */

export async function listOnboardingItems(db: Db, actor: Actor, clientId: string) {
  await assertClientAccess(db, actor, clientId);
  return db.select().from(onboardingItems).where(and(inFirm(onboardingItems.firmId, actor), eq(onboardingItems.clientId, clientId))).orderBy(asc(onboardingItems.createdAt));
}

/**
 * Onboarding status follows the checklist: nothing requested → not started; any information
 * still requested → information requested; any document still requested → awaiting documents;
 * everything received but not all verified → under verification; all verified/waived → completed.
 */
export function deriveOnboardingStatus(items: { kind: "information" | "document"; status: "requested" | "received" | "verified" | "waived" }[]): OnboardingStatus {
  if (!items.length) return "not_started";
  const open = items.filter((i) => i.status === "requested");
  if (open.some((i) => i.kind === "information")) return "information_requested";
  if (open.length) return "awaiting_documents";
  if (items.some((i) => i.status === "received")) return "under_verification";
  return "completed";
}

async function syncOnboarding(db: Db, actor: Actor, clientId: string): Promise<OnboardingStatus> {
  const items = await db.select({ kind: onboardingItems.kind, status: onboardingItems.status }).from(onboardingItems).where(and(inFirm(onboardingItems.firmId, actor), eq(onboardingItems.clientId, clientId)));
  const status = deriveOnboardingStatus(items);
  const [before] = await db.select({ onboardingStatus: clients.onboardingStatus, status: clients.status }).from(clients).where(and(eq(clients.id, clientId), inFirm(clients.firmId, actor)));
  if (before && before.onboardingStatus !== status) {
    // A client in onboarding becomes active once onboarding completes.
    const promote = status === "completed" && before.status === "onboarding";
    await db.update(clients).set({ onboardingStatus: status, ...(promote ? { status: "active" as const } : {}), updatedAt: new Date() }).where(and(eq(clients.id, clientId), inFirm(clients.firmId, actor)));
    await logActivity(db, actor, { entityType: "client", entityId: clientId, clientId, type: "status_change", metadata: { field: "onboarding", from: before.onboardingStatus, to: status } });
    if (promote) await recordStatusChange(db, actor, { entityType: "client", entityId: clientId, clientId, from: "onboarding", to: "active", note: "Onboarding completed" });
  }
  return status;
}

export async function addOnboardingItem(db: Db, actor: Actor, clientId: string, input: unknown) {
  requirePermission(actor, "clients", "edit");
  await assertClientAccess(db, actor, clientId);
  const d = parseInput(onboardingItemSchema, input);
  return db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Db;
    await tx.insert(onboardingItems).values({ firmId: actor.firmId, clientId, title: d.title, kind: d.kind, requestedById: actor.userId });
    await logActivity(tx, actor, { entityType: "client", entityId: clientId, clientId, type: "system", body: `Requested ${d.kind === "document" ? "document" : "information"}: ${d.title}` });
    return syncOnboarding(tx, actor, clientId);
  });
}

/** received / verified (verification needs edit permission; managers/admins in practice) / waived / requested again. */
export async function setOnboardingItemStatus(db: Db, actor: Actor, clientId: string, itemId: string, status: "requested" | "received" | "verified" | "waived") {
  requirePermission(actor, "clients", "edit");
  await assertClientAccess(db, actor, clientId);
  if (!isUuid(itemId)) throw new NotFoundError();
  if (!["requested", "received", "verified", "waived"].includes(status)) throw new ValidationError({ status: ["Choose a status."] });
  if (status === "waived") requirePermission(actor, "clients", "approve");
  return db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Db;
    const now = new Date();
    const [row] = await tx
      .update(onboardingItems)
      .set({
        status,
        receivedAt: status === "requested" ? null : now,
        verifiedAt: status === "verified" ? now : null,
        verifiedById: status === "verified" ? actor.userId : null,
        updatedAt: now,
      })
      .where(and(eq(onboardingItems.id, itemId), eq(onboardingItems.clientId, clientId), inFirm(onboardingItems.firmId, actor), ne(onboardingItems.status, status)))
      .returning({ title: onboardingItems.title });
    if (row) await logActivity(tx, actor, { entityType: "client", entityId: clientId, clientId, type: "system", body: `${row.title}: ${status}` });
    return syncOnboarding(tx, actor, clientId);
  });
}
