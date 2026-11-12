import { and, desc, eq, gte, ilike, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "@/db";
import { leads, users, type Lead, type LeadStatus } from "@/db/schema";
import type { Actor } from "@/lib/auth/actor";
import { AppError, NotFoundError, ValidationError } from "@/lib/errors";
import { isUuid, leadInputSchema, leadUpdateSchema, parseInput, websiteInquirySchema } from "@/lib/validation";
import { assertActiveStaffUser, requireStaff } from "./access";
import { recordAudit } from "./audit";
import { createClient } from "./clients";

/**
 * Leads hold prospect contact details only (no taxpayer data), so every staff
 * member may work them. Portal users never can.
 */

export const OPEN_LEAD_STATUSES: LeadStatus[] = ["new", "contacted", "qualified"];

export interface LeadRow extends Lead {
  ownerName: string | null;
}

const owner = alias(users, "lead_owner");

export async function listLeads(db: Db, actor: Actor, opts: { status?: LeadStatus | "open"; q?: string } = {}): Promise<LeadRow[]> {
  requireStaff(actor);
  const q = opts.q?.trim().slice(0, 100);
  const like = q ? `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : undefined;
  const statusFilter =
    opts.status === "open"
      ? sql`${leads.status} in ('new', 'contacted', 'qualified')`
      : opts.status
        ? eq(leads.status, opts.status)
        : undefined;
  const rows = await db
    .select({ lead: leads, ownerName: owner.name })
    .from(leads)
    .leftJoin(owner, eq(owner.id, leads.ownerId))
    .where(and(statusFilter, like ? or(ilike(leads.name, like), ilike(leads.email, like), ilike(leads.phone, like), ilike(leads.company, like)) : undefined))
    .orderBy(desc(leads.createdAt))
    .limit(300);
  return rows.map((r) => ({ ...r.lead, ownerName: r.ownerName }));
}

export async function getLead(db: Db, actor: Actor, id: string): Promise<LeadRow> {
  requireStaff(actor);
  if (!isUuid(id)) throw new NotFoundError();
  const [row] = await db.select({ lead: leads, ownerName: owner.name }).from(leads).leftJoin(owner, eq(owner.id, leads.ownerId)).where(eq(leads.id, id));
  if (!row) throw new NotFoundError();
  return { ...row.lead, ownerName: row.ownerName };
}

export async function countLeadsByStatus(db: Db, actor: Actor): Promise<Record<LeadStatus, number>> {
  requireStaff(actor);
  const rows = await db.select({ status: leads.status, n: sql<number>`count(*)::int` }).from(leads).groupBy(leads.status);
  const out = { new: 0, contacted: 0, qualified: 0, converted: 0, lost: 0 } as Record<LeadStatus, number>;
  for (const r of rows) out[r.status] = r.n;
  return out;
}

export async function createLead(db: Db, actor: Actor, input: unknown): Promise<Lead> {
  requireStaff(actor);
  const data = parseInput(leadInputSchema, input);
  const [lead] = await db.insert(leads).values({ ...data, ownerId: actor.userId }).returning();
  if (!lead) throw new Error("Insert returned no row");
  await recordAudit(db, { actorUserId: actor.userId, action: "lead.create", entityType: "lead", entityId: lead.id, metadata: { source: data.source } });
  return lead;
}

export async function updateLead(db: Db, actor: Actor, id: string, input: unknown): Promise<Lead> {
  const existing = await getLead(db, actor, id);
  if (existing.status === "converted") throw new ValidationError({ _form: ["This lead was converted to a client. Edit the client record instead."] });
  const data = parseInput(leadUpdateSchema, input);
  if (data.ownerId) await assertActiveStaffUser(db, data.ownerId, "ownerId");
  const next = {
    name: data.name,
    email: data.email ?? null,
    phone: data.phone ?? null,
    company: data.company ?? null,
    serviceInterest: data.serviceInterest ?? null,
    source: data.source,
    message: data.message ?? null,
    status: data.status,
    ownerId: data.ownerId ?? null,
    followUpDate: data.followUpDate ?? null,
    notes: data.notes ?? null,
  };
  const changed = (Object.keys(next) as (keyof typeof next)[]).filter((k) => next[k] !== existing[k]);
  if (!changed.length) return existing;
  const [updated] = await db.update(leads).set({ ...next, updatedAt: new Date() }).where(eq(leads.id, id)).returning();
  await recordAudit(db, { actorUserId: actor.userId, action: "lead.update", entityType: "lead", entityId: id, metadata: { changedFields: changed } });
  return updated!;
}

/** Moves a lead to another pipeline stage (used by bulk actions). Converted leads cannot be changed. */
export async function setLeadStatus(db: Db, actor: Actor, id: string, status: "new" | "contacted" | "qualified" | "lost"): Promise<void> {
  const lead = await getLead(db, actor, id);
  if (lead.status === "converted") throw new ValidationError({ _form: ["Converted leads can’t be changed."] });
  if (!["new", "contacted", "qualified", "lost"].includes(status)) throw new ValidationError({ status: ["Choose a status."] });
  if (lead.status === status) return;
  await db.update(leads).set({ status, updatedAt: new Date() }).where(eq(leads.id, id));
  await recordAudit(db, { actorUserId: actor.userId, action: "lead.update", entityType: "lead", entityId: id, metadata: { changedFields: ["status"] } });
}

/** Turns a lead into a client record. Idempotent: a converted lead returns its client. */
export async function convertLead(db: Db, actor: Actor, id: string): Promise<{ clientId: string }> {
  const lead = await getLead(db, actor, id);
  if (lead.status === "converted" && lead.convertedClientId) return { clientId: lead.convertedClientId };
  const client = await createClient(db, actor, {
    type: lead.company ? "business" : "individual",
    displayName: lead.company || lead.name,
    email: lead.email ?? "",
    phone: lead.phone ?? "",
    status: "active",
  });
  await db
    .update(leads)
    .set({ status: "converted", convertedClientId: client.id, updatedAt: new Date() })
    .where(eq(leads.id, id));
  await recordAudit(db, { actorUserId: actor.userId, action: "lead.convert", entityType: "lead", entityId: id, metadata: { clientId: client.id } });
  return { clientId: client.id };
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
 * Creates a lead from the public website. Anti-abuse: a hidden honeypot field,
 * a minimum fill time, and a per-email hourly cap (per-IP limiting is applied
 * by the caller). No account is created. The caller sends the staff alert email.
 */
export async function submitWebsiteInquiry(
  db: Db,
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
    .where(and(eq(leads.email, data.email), eq(leads.source, "website"), gte(leads.createdAt, new Date(now.getTime() - 3600_000))));
  if ((recent?.n ?? 0) >= INQUIRY_MAX_PER_EMAIL_PER_HOUR) throw new SpamRejectedError();

  const [lead] = await db
    .insert(leads)
    .values({
      name: data.name,
      email: data.email,
      phone: data.phone ?? null,
      serviceInterest: data.serviceInterest ?? null,
      message: data.message ?? null,
      source: "website",
      status: "new",
      consentAt: now,
    })
    .returning({ id: leads.id });
  await recordAudit(db, { actorUserId: null, action: "lead.website_inquiry", entityType: "lead", entityId: lead!.id });
  return { id: lead!.id, name: data.name, serviceInterest: data.serviceInterest ?? null };
}
