import { and, desc, eq, gte, ilike, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "@/db";
import { clients, leads, users, type Lead, type LeadSource, type LeadStatus, type Priority } from "@/db/schema";
import type { Actor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/permissions";
import { AppError, NotFoundError, ValidationError } from "@/lib/errors";
import { LEAD_OPEN } from "@/lib/status";
import { activityInputSchema, isUuid, leadConversionSchema, leadFollowUpSchema, leadInputSchema, leadStatusChangeSchema, leadUpdateSchema, parseInput, websiteInquirySchema } from "@/lib/validation";
import { assertActiveStaffUser, assertClientAccess, inFirm, requirePermission, requireStaff } from "./access";
import { recordAudit } from "./audit";
import { createClient, findPossibleDuplicates, type DuplicateCandidate } from "./clients";
import { logActivity, nextNumber, recordStatusChange } from "./timeline";

/**
 * Leads & prospects: potential customers before they become clients. A lead is never a
 * client automatically — it becomes one only through `convertLead`, which is transactional,
 * checks for duplicates, and can link to an existing client instead of creating one.
 * Leads hold contact details only (no taxpayer data), so every staff member can work them.
 */

export const OPEN_LEAD_STATUSES: LeadStatus[] = [...LEAD_OPEN];

export interface LeadRow extends Lead {
  ownerName: string | null;
  convertedClientName: string | null;
}

export interface LeadDetail extends LeadRow {
  /** Resolved even if that staff member is no longer active. */
  convertedByName: string | null;
}

const owner = alias(users, "lead_owner");
const converter = alias(users, "lead_converter");
const convertedClient = alias(clients, "lead_client");

export interface LeadFilters {
  status?: LeadStatus | "open";
  q?: string;
  source?: LeadSource;
  ownerId?: string | "none";
  priority?: Priority;
  createdFrom?: string; // YYYY-MM-DD
  createdTo?: string;
  followUpDue?: boolean; // follow-up on or before today
  today?: string;
  sort?: "created" | "follow_up";
}

function likeContains(q: string) {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export async function listLeads(db: Db, actor: Actor, opts: LeadFilters = {}): Promise<LeadRow[]> {
  requireStaff(actor);
  const q = opts.q?.trim().slice(0, 100);
  const like = q ? likeContains(q) : undefined;
  const rows = await db
    .select({ lead: leads, ownerName: owner.name, convertedClientName: convertedClient.displayName })
    .from(leads)
    .leftJoin(owner, eq(owner.id, leads.ownerId))
    .leftJoin(convertedClient, eq(convertedClient.id, leads.convertedClientId))
    .where(
      and(
        inFirm(leads.firmId, actor),
        isNull(leads.archivedAt),
        opts.status === "open" ? inArray(leads.status, LEAD_OPEN) : opts.status ? eq(leads.status, opts.status) : undefined,
        like ? or(ilike(leads.name, like), ilike(leads.email, like), ilike(leads.phone, like), ilike(leads.company, like)) : undefined,
        opts.source ? eq(leads.source, opts.source) : undefined,
        opts.ownerId === "none" ? isNull(leads.ownerId) : opts.ownerId && isUuid(opts.ownerId) ? eq(leads.ownerId, opts.ownerId) : undefined,
        opts.priority ? eq(leads.priority, opts.priority) : undefined,
        opts.createdFrom ? gte(leads.createdAt, new Date(`${opts.createdFrom}T00:00:00Z`)) : undefined,
        opts.createdTo ? lte(leads.createdAt, new Date(`${opts.createdTo}T23:59:59Z`)) : undefined,
        opts.followUpDue && opts.today ? and(inArray(leads.status, LEAD_OPEN), lte(leads.followUpDate, opts.today)) : undefined,
      ),
    )
    .orderBy(...(opts.sort === "follow_up" ? [sql`${leads.followUpDate} asc nulls last`, desc(leads.createdAt)] : [desc(leads.createdAt)]))
    .limit(1000);
  return rows.map((r) => ({ ...r.lead, ownerName: r.ownerName, convertedClientName: r.convertedClientName }));
}

export async function getLead(db: Db, actor: Actor, id: string): Promise<LeadDetail> {
  requireStaff(actor);
  if (!isUuid(id)) throw new NotFoundError();
  const [row] = await db
    .select({ lead: leads, ownerName: owner.name, convertedClientName: convertedClient.displayName, convertedByName: converter.name })
    .from(leads)
    .leftJoin(owner, eq(owner.id, leads.ownerId))
    .leftJoin(convertedClient, eq(convertedClient.id, leads.convertedClientId))
    .leftJoin(converter, eq(converter.id, leads.convertedById))
    .where(and(eq(leads.id, id), inFirm(leads.firmId, actor)));
  if (!row) throw new NotFoundError();
  return { ...row.lead, ownerName: row.ownerName, convertedClientName: row.convertedClientName, convertedByName: row.convertedByName };
}

export async function countLeadsByStatus(db: Db, actor: Actor): Promise<Record<LeadStatus, number>> {
  requireStaff(actor);
  const rows = await db
    .select({ status: leads.status, n: sql<number>`count(*)::int` })
    .from(leads)
    .where(and(inFirm(leads.firmId, actor), isNull(leads.archivedAt)))
    .groupBy(leads.status);
  const out = Object.fromEntries(
    (["new", "contacted", "qualified", "consultation_scheduled", "proposal_sent", "negotiation", "converted", "lost", "nurture"] as LeadStatus[]).map((s) => [s, 0]),
  ) as Record<LeadStatus, number>;
  for (const r of rows) out[r.status] = r.n;
  return out;
}

/** Normalizes requested services so service_interest (used by older screens) is the first one. */
function services(d: { serviceInterest?: Lead["serviceInterest"] | undefined; requestedServices: NonNullable<Lead["requestedServices"]> }) {
  const list = d.requestedServices.length ? d.requestedServices : d.serviceInterest ? [d.serviceInterest] : [];
  return { requestedServices: [...new Set(list)], serviceInterest: list[0] ?? null };
}

export async function createLead(db: Db, actor: Actor, input: unknown): Promise<Lead> {
  requirePermission(actor, "leads", "create");
  const data = parseInput(leadInputSchema, input);
  const ownerId = data.ownerId ?? actor.userId;
  if (ownerId !== actor.userId) {
    requirePermission(actor, "leads", "assign");
    await assertActiveStaffUser(db, actor, ownerId, "ownerId");
  }
  return db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Db;
    const [lead] = await tx
      .insert(leads)
      .values({
        firmId: actor.firmId,
        leadNumber: await nextNumber(tx, actor.firmId, "lead"),
        name: data.name,
        email: data.email ?? null,
        phone: data.phone ?? null,
        company: data.company ?? null,
        clientType: data.clientType ?? (data.company ? "business" : null),
        address: data.address ?? null,
        ...services(data),
        source: data.source,
        priority: data.priority,
        estimatedValueCents: data.estimatedValueCents ?? null,
        ownerId,
        followUpDate: data.followUpDate ?? null,
        message: data.message ?? null,
      })
      .returning();
    if (!lead) throw new Error("Insert returned no row");
    await recordAudit(tx, { firmId: actor.firmId, actorUserId: actor.userId, action: "lead.create", entityType: "lead", entityId: lead.id, metadata: { source: data.source } });
    await logActivity(tx, actor, { entityType: "lead", entityId: lead.id, type: "system", body: "Lead created" });
    await recordStatusChange(tx, actor, { entityType: "lead", entityId: lead.id, from: null, to: "new" });
    await logActivity(tx, actor, { entityType: "lead", entityId: lead.id, type: "assignment", metadata: { userId: ownerId } });
    return lead;
  });
}

export async function updateLead(db: Db, actor: Actor, id: string, input: unknown): Promise<Lead> {
  requirePermission(actor, "leads", "edit");
  const existing = await getLead(db, actor, id);
  if (existing.status === "converted") throw new ValidationError({ _form: ["This lead was converted to a client. Edit the client record instead."] });
  const data = parseInput(leadUpdateSchema, input);
  if (data.ownerId && data.ownerId !== existing.ownerId) {
    requirePermission(actor, "leads", "assign");
    await assertActiveStaffUser(db, actor, data.ownerId, "ownerId");
  }
  const s = services(data);
  const next = {
    name: data.name,
    email: data.email ?? null,
    phone: data.phone ?? null,
    company: data.company ?? null,
    clientType: data.clientType ?? null,
    address: data.address ?? null,
    serviceInterest: s.serviceInterest,
    source: data.source,
    priority: data.priority,
    estimatedValueCents: data.estimatedValueCents ?? null,
    message: data.message ?? null,
    ownerId: data.ownerId ?? null,
    followUpDate: data.followUpDate ?? null,
    notes: data.notes ?? null,
  };
  const changed = (Object.keys(next) as (keyof typeof next)[]).filter((k) => next[k] !== existing[k]);
  const servicesChanged = JSON.stringify(s.requestedServices) !== JSON.stringify(existing.requestedServices ?? []);
  if (!changed.length && !servicesChanged) return existing;
  return db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Db;
    const [updated] = await tx
      .update(leads)
      .set({ ...next, requestedServices: s.requestedServices, updatedAt: new Date() })
      .where(and(eq(leads.id, id), inFirm(leads.firmId, actor)))
      .returning();
    const fields = [...changed, ...(servicesChanged ? ["requestedServices"] : [])];
    await recordAudit(tx, { firmId: actor.firmId, actorUserId: actor.userId, action: "lead.update", entityType: "lead", entityId: id, metadata: { changedFields: fields } });
    if (changed.includes("ownerId")) await logActivity(tx, actor, { entityType: "lead", entityId: id, type: "assignment", metadata: { userId: next.ownerId } });
    if (changed.includes("followUpDate") && next.followUpDate) await logActivity(tx, actor, { entityType: "lead", entityId: id, type: "system", body: "Follow-up scheduled", metadata: { followUpDate: next.followUpDate } });
    const other = fields.filter((f) => f !== "ownerId" && f !== "followUpDate");
    if (other.length) await logActivity(tx, actor, { entityType: "lead", entityId: id, type: "system", body: "Lead details updated", metadata: { changedFields: other } });
    return updated!;
  });
}

/**
 * Moves a lead to another stage, recording who/when/from→to. "Won / Converted" is only
 * reachable through conversion; "Lost" requires a reason. Converted leads cannot move.
 */
export async function setLeadStatus(db: Db, actor: Actor, id: string, input: unknown): Promise<void> {
  requirePermission(actor, "leads", "edit");
  const d = parseInput(leadStatusChangeSchema, typeof input === "string" ? { status: input } : input);
  const lead = await getLead(db, actor, id);
  if (lead.status === "converted") throw new ValidationError({ _form: ["Converted leads can’t be moved. The client record holds the relationship now."] });
  if (lead.status === d.status) return;
  await db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Db;
    await tx
      .update(leads)
      .set({ status: d.status, lostReason: d.status === "lost" ? (d.lostReason ?? null) : null, updatedAt: new Date() })
      .where(and(eq(leads.id, id), inFirm(leads.firmId, actor)));
    await recordStatusChange(tx, actor, { entityType: "lead", entityId: id, from: lead.status, to: d.status, note: d.status === "lost" ? d.lostReason : d.note });
    await recordAudit(tx, { firmId: actor.firmId, actorUserId: actor.userId, action: "lead.update", entityType: "lead", entityId: id, metadata: { changedFields: ["status"] } });
  });
}

/** Schedules or clears a lead follow-up directly, without resubmitting the full lead form. */
export async function setLeadFollowUpDate(db: Db, actor: Actor, id: string, input: unknown): Promise<void> {
  requirePermission(actor, "leads", "edit");
  const { followUpDate } = parseInput(leadFollowUpSchema, input);
  const lead = await getLead(db, actor, id);
  if (lead.status === "converted") throw new ValidationError({ _form: ["This lead was converted to a client. Schedule follow-up from the client record instead."] });
  const nextDate = followUpDate ?? null;
  if ((lead.followUpDate ?? null) === nextDate) return;

  await db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Db;
    await tx.update(leads)
      .set({ followUpDate: nextDate, updatedAt: new Date() })
      .where(and(eq(leads.id, id), inFirm(leads.firmId, actor)));
    await recordAudit(tx, {
      firmId: actor.firmId,
      actorUserId: actor.userId,
      action: nextDate ? "lead.follow_up_scheduled" : "lead.follow_up_cleared",
      entityType: "lead",
      entityId: id,
      metadata: { changedFields: ["followUpDate"] },
    });
    await logActivity(tx, actor, {
      entityType: "lead",
      entityId: id,
      type: "system",
      body: nextDate ? "Follow-up scheduled" : "Follow-up cleared",
      ...(nextDate ? { metadata: { followUpDate: nextDate } } : {}),
    });
  });
}

/** Logs a note, call, email or meeting. Calls/emails/meetings update "last contacted". */
export async function addLeadActivity(db: Db, actor: Actor, id: string, input: unknown): Promise<void> {
  requirePermission(actor, "leads", "edit");
  const lead = await getLead(db, actor, id);
  const d = parseInput(activityInputSchema, input);
  const occurredAt = d.occurredAt ? new Date(d.occurredAt) : new Date();
  const contact = d.type === "call" || d.type === "email" || d.type === "meeting";
  await db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Db;
    await logActivity(tx, actor, { entityType: "lead", entityId: id, clientId: lead.convertedClientId, type: d.type, body: d.body, occurredAt });
    const patch: Partial<Lead> = {};
    if (contact && (!lead.lastContactedAt || occurredAt > lead.lastContactedAt)) patch.lastContactedAt = occurredAt;
    if (d.followUpDate) patch.followUpDate = d.followUpDate;
    // Recording first contact with a new lead moves it to Contacted.
    const autoContacted = contact && lead.status === "new";
    if (autoContacted) patch.status = "contacted";
    if (Object.keys(patch).length) await tx.update(leads).set({ ...patch, updatedAt: new Date() }).where(and(eq(leads.id, id), inFirm(leads.firmId, actor)));
    if (autoContacted) await recordStatusChange(tx, actor, { entityType: "lead", entityId: id, from: "new", to: "contacted", note: `First ${d.type} recorded` });
    if (d.followUpDate) await logActivity(tx, actor, { entityType: "lead", entityId: id, type: "system", body: "Follow-up scheduled", metadata: { followUpDate: d.followUpDate } });
  });
}

/** Possible existing clients for this lead (same email, phone or name). */
export async function findLeadDuplicates(db: Db, actor: Actor, id: string): Promise<DuplicateCandidate[]> {
  const lead = await getLead(db, actor, id);
  return findPossibleDuplicates(db, actor, { name: lead.name, company: lead.company, email: lead.email, phone: lead.phone });
}

export class AlreadyConvertedError extends AppError {
  constructor(readonly clientId: string) {
    super("This lead was already converted.");
  }
}

/**
 * Converts a lead into a client, transactionally:
 *  - mode "existing": links the lead to a client already in the CRM (no new record);
 *  - mode "new": creates the client — refused if it looks like a duplicate unless the user confirmed.
 * The lead keeps its history, is marked Won / Converted, and records when and by whom.
 * A second conversion of the same lead is refused (the row is locked, so double clicks can't race).
 * No engagement is created here.
 */
export async function convertLead(db: Db, actor: Actor, id: string, input: unknown): Promise<{ clientId: string; created: boolean }> {
  requirePermission(actor, "leads", "edit");
  requirePermission(actor, "clients", "create");
  const d = parseInput(leadConversionSchema, input);

  return db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Db;
    if (!isUuid(id)) throw new NotFoundError();
    // Lock the lead so two conversions can't run at once.
    const [lead] = await tx.select().from(leads).where(and(eq(leads.id, id), inFirm(leads.firmId, actor))).for("update");
    if (!lead) throw new NotFoundError();
    if (lead.status === "converted" || lead.convertedClientId) throw new AlreadyConvertedError(lead.convertedClientId ?? "");

    let clientId: string;
    let created = false;
    if (d.mode === "existing") {
      await assertClientAccess(tx, actor, d.clientId);
      clientId = d.clientId;
    } else {
      const dupes = await findPossibleDuplicates(tx, actor, { name: d.displayName, company: lead.company, email: d.email ?? lead.email, phone: d.phone ?? lead.phone });
      if (dupes.length && !d.confirmNotDuplicate) {
        throw new ValidationError(
          { _form: [`Possible duplicate: ${dupes.map((c) => c.displayName).join(", ")}. Link the lead to the existing client, or confirm this is a different client.`] },
          "This client may already exist.",
        );
      }
      const client = await createClient(
        tx,
        actor,
        {
          type: d.type,
          displayName: d.displayName,
          firstName: d.firstName ?? "",
          lastName: d.lastName ?? "",
          email: d.email ?? "",
          phone: d.phone ?? "",
          address: d.address ?? "",
          accountManagerId: d.accountManagerId ?? lead.ownerId ?? "",
          status: "onboarding",
        },
        { sourceLeadId: lead.id },
      );
      clientId = client.id;
      created = true;
    }

    const now = new Date();
    await tx
      .update(leads)
      .set({ status: "converted", convertedClientId: clientId, convertedAt: now, convertedById: actor.userId, updatedAt: now })
      .where(and(eq(leads.id, id), inFirm(leads.firmId, actor)));
    await recordStatusChange(tx, actor, { entityType: "lead", entityId: id, clientId, from: lead.status, to: "converted", note: created ? "Converted to a new client" : "Linked to an existing client" });
    await logActivity(tx, actor, { entityType: "client", entityId: clientId, clientId, type: "system", body: `Linked lead ${lead.name}`, metadata: { leadId: id } });
    await recordAudit(tx, { firmId: actor.firmId, actorUserId: actor.userId, action: "lead.convert", entityType: "lead", entityId: id, metadata: { clientId, created } });
    return { clientId, created };
  });
}

/** Soft-archive (e.g. spam or test leads). Converted leads stay for the client's history. */
export async function setLeadArchived(db: Db, actor: Actor, id: string, archived: boolean): Promise<void> {
  requirePermission(actor, "leads", "delete");
  const lead = await getLead(db, actor, id);
  if (archived && lead.status === "converted") throw new ValidationError({ _form: ["Converted leads are kept with the client’s history."] });
  await db.update(leads).set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() }).where(and(eq(leads.id, id), inFirm(leads.firmId, actor)));
  await recordAudit(db, { firmId: actor.firmId, actorUserId: actor.userId, action: archived ? "lead.archive" : "lead.restore", entityType: "lead", entityId: id });
}

/** CSV of the leads matching the filters. Requires the export permission. */
export async function exportLeadsCsv(db: Db, actor: Actor, filters: LeadFilters = {}): Promise<string> {
  requirePermission(actor, "leads", "export");
  const rows = await listLeads(db, actor, filters);
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    // Quote, and neutralize spreadsheet formulas (CSV injection).
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const header = ["Number", "Name", "Company", "Email", "Phone", "Type", "Source", "Stage", "Priority", "Services", "Estimated value", "Owner", "Follow-up", "Last contacted", "Created"];
  const lines = rows.map((r) =>
    [
      r.leadNumber ? `L-${String(r.leadNumber).padStart(4, "0")}` : "",
      r.name,
      r.company,
      r.email,
      r.phone,
      r.clientType,
      r.source,
      r.status,
      r.priority,
      (r.requestedServices ?? []).join("; "),
      r.estimatedValueCents !== null ? (r.estimatedValueCents / 100).toFixed(2) : "",
      r.ownerName,
      r.followUpDate,
      r.lastContactedAt?.toISOString() ?? "",
      r.createdAt.toISOString(),
    ]
      .map(cell)
      .join(","),
  );
  await recordAudit(db, { firmId: actor.firmId, actorUserId: actor.userId, action: "lead.export", entityType: "lead", entityId: null, metadata: { count: rows.length } });
  return [header.map(cell).join(","), ...lines].join("\r\n");
}

export function canExportLeads(actor: Actor) {
  return can(actor, "leads", "export");
}

/* ───────── Public website inquiry form ───────── */

export class SpamRejectedError extends AppError {
  constructor() {
    super("We couldn’t send your message. Please call or email us instead.");
  }
}

export const INQUIRY_MIN_FILL_MS = 3000;
export const INQUIRY_MAX_PER_EMAIL_PER_HOUR = 3;

/**
 * Creates a lead from a trusted firm-owned inquiry integration. Anti-abuse: a
 * hidden honeypot field, a minimum fill time, and a per-email hourly cap (per-IP
 * limiting is applied by the caller). No account is created. `firmId` must be
 * resolved by the server; it is not taken from unauthenticated form input.
 */
export async function submitWebsiteInquiry(
  db: Db,
  firmId: string,
  input: Record<string, unknown>,
  now = new Date(),
): Promise<{ id: string; name: string; serviceInterest: string | null }> {
  if (typeof input.website === "string" && input.website.trim() !== "") throw new SpamRejectedError();
  const started = Number(input.startedAt);
  if (!Number.isFinite(started) || now.getTime() - started < INQUIRY_MIN_FILL_MS || now.getTime() - started > 24 * 3600_000) {
    throw new SpamRejectedError();
  }
  const data = parseInput(websiteInquirySchema, input);
  const [recent] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(leads)
    .where(and(eq(leads.firmId, firmId), eq(leads.email, data.email), eq(leads.source, "website"), gte(leads.createdAt, new Date(now.getTime() - 3600_000))));
  if ((recent?.n ?? 0) >= INQUIRY_MAX_PER_EMAIL_PER_HOUR) throw new SpamRejectedError();

  return db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Db;
    const [lead] = await tx
      .insert(leads)
      .values({
        firmId,
        leadNumber: await nextNumber(tx, firmId, "lead"),
        name: data.name,
        email: data.email,
        phone: data.phone ?? null,
        serviceInterest: data.serviceInterest ?? null,
        requestedServices: data.serviceInterest ? [data.serviceInterest] : [],
        message: data.message ?? null,
        source: "website",
        status: "new",
        consentAt: now,
      })
      .returning({ id: leads.id });
    const who = { firmId, userId: null };
    await recordAudit(tx, { firmId, actorUserId: null, action: "lead.website_inquiry", entityType: "lead", entityId: lead!.id });
    await logActivity(tx, who, { entityType: "lead", entityId: lead!.id, type: "system", body: "Inquiry received from the website" });
    await recordStatusChange(tx, who, { entityType: "lead", entityId: lead!.id, from: null, to: "new" });
    return { id: lead!.id, name: data.name, serviceInterest: data.serviceInterest ?? null };
  });
}
