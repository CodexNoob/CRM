import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { firms, leads, tasks, users, type Lead } from "@/db/schema";
import { recordAudit } from "@/services/audit";
import { nextNumber, logActivity, recordStatusChange } from "@/services/timeline";
import { firmToday } from "@/services/dashboard";

export interface GoHighLevelLeadInput {
  contactId: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  source?: string | null;
  tags?: string[];
}

export type GoHighLevelLeadResult = { id: string; action: "created" | "updated" };

const LEAD_OWNER_ROLES = ["admin", "administrator", "operations_manager", "project_manager", "team_member", "sales_manager", "sales_representative", "account_manager", "manager", "employee"] as const;

function nextBusinessDay(now: Date): string {
  const date = new Date(`${firmToday(now)}T00:00:00.000Z`);
  do date.setUTCDate(date.getUTCDate() + 1);
  while (date.getUTCDay() === 0 || date.getUTCDay() === 6);
  return date.toISOString().slice(0, 10);
}

async function nextLeadOwner(tx: Db, firmId: string, cursor: number): Promise<string | null> {
  const candidates = await tx.select({ id: users.id }).from(users)
    .where(and(eq(users.firmId, firmId), eq(users.isActive, true), inArray(users.role, [...LEAD_OWNER_ROLES])))
    .orderBy(asc(users.createdAt), asc(users.id));
  if (!candidates.length) return null;
  const index = cursor % candidates.length;
  await tx.update(firms).set({ leadAssignmentCursor: (index + 1) % candidates.length }).where(eq(firms.id, firmId));
  return candidates[index]!.id;
}

async function createLeadFollowUpTask(tx: Db, firmId: string, lead: Pick<Lead, "id" | "name">, ownerId: string | null, dueDate: string) {
  const [task] = await tx.insert(tasks).values({
    firmId,
    leadId: lead.id,
    taskNumber: await nextNumber(tx, firmId, "task"),
    title: `Follow up with ${lead.name}`.slice(0, 300),
    description: `New GoHighLevel lead. Review the lead record and complete the first follow-up.`,
    assigneeId: ownerId,
    assignedById: null,
    isClientTask: false,
    startDate: dueDate,
    dueDate,
  }).returning({ id: tasks.id });
  if (!task) throw new Error("Could not create lead follow-up task.");
  await recordAudit(tx, { firmId, actorUserId: null, action: "task.gohighlevel_follow_up_create", entityType: "task", entityId: task.id, metadata: { leadId: lead.id } });
  await logActivity(tx, { firmId, userId: null }, { entityType: "task", entityId: task.id, type: "system", body: "Follow-up task created from GoHighLevel lead" });
  await recordStatusChange(tx, { firmId, userId: null }, { entityType: "task", entityId: task.id, from: null, to: "todo" });
  if (ownerId) await logActivity(tx, { firmId, userId: null }, { entityType: "task", entityId: task.id, type: "assignment", metadata: { userId: ownerId, title: `Follow up with ${lead.name}` } });
}

function normalizedEmail(email?: string | null) {
  const value = email?.trim().toLowerCase();
  return value || null;
}

function normalizedPhone(phone?: string | null) {
  const value = phone?.replace(/[^\d+]/g, "");
  return value || null;
}

/** Inbound GoHighLevel contact sync. CRM stage, owner, notes and consent remain CRM-owned. */
export async function syncGoHighLevelLead(db: Db, firmId: string, input: GoHighLevelLeadInput, now = new Date()): Promise<GoHighLevelLeadResult> {
  const email = normalizedEmail(input.email);
  const phone = normalizedPhone(input.phone);
  return db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Db;
    const [firm] = await tx.select({ id: firms.id, leadAssignmentCursor: firms.leadAssignmentCursor }).from(firms)
      .where(eq(firms.id, firmId)).for("update").limit(1);
    if (!firm) throw new Error("No firm is configured for GoHighLevel lead sync.");
    const [existing] = await tx.select().from(leads)
      .where(and(eq(leads.firmId, firm.id), or(
        eq(leads.goHighLevelContactId, input.contactId),
        ...(email ? [sql`lower(${leads.email}) = ${email}`] : []),
        ...(phone ? [sql`regexp_replace(coalesce(${leads.phone}, ''), '[^0-9+]', '', 'g') = ${phone}`] : []),
      )))
      .for("update").limit(1);

    if (existing) {
      if (existing.status === "converted") {
        await recordAudit(tx, { firmId: firm.id, actorUserId: null, action: "lead.gohighlevel_match_converted", entityType: "lead", entityId: existing.id });
        return { id: existing.id, action: "updated" };
      }
      const ownerId = existing.ownerId ?? await nextLeadOwner(tx, firm.id, firm.leadAssignmentCursor);
      const followUpDate = existing.followUpDate ?? nextBusinessDay(now);
      const changedFields = [
        ...(existing.goHighLevelContactId !== input.contactId ? ["goHighLevelContactId"] : []),
        ...(existing.name !== input.name ? ["name"] : []),
        ...(email && email !== existing.email ? ["email"] : []),
        ...(phone && phone !== existing.phone ? ["phone"] : []),
        ...(!existing.ownerId && ownerId ? ["ownerId"] : []),
        ...(!existing.followUpDate ? ["followUpDate"] : []),
      ];
      const [updated] = await tx.update(leads).set({
        goHighLevelContactId: input.contactId,
        name: input.name,
        ...(email ? { email } : {}),
        ...(phone ? { phone } : {}),
        ...(input.company ? { company: input.company } : {}),
        ...(!existing.ownerId && ownerId ? { ownerId } : {}),
        ...(!existing.followUpDate ? { followUpDate } : {}),
        updatedAt: now,
      }).where(eq(leads.id, existing.id)).returning({ id: leads.id });
      await recordAudit(tx, { firmId: firm.id, actorUserId: null, action: "lead.gohighlevel_update", entityType: "lead", entityId: existing.id, metadata: { changedFields } });
      if (!existing.ownerId && ownerId) await logActivity(tx, { firmId: firm.id, userId: null }, { entityType: "lead", entityId: existing.id, type: "assignment", metadata: { userId: ownerId, title: existing.name } });
      if (!existing.followUpDate) {
        await logActivity(tx, { firmId: firm.id, userId: null }, { entityType: "lead", entityId: existing.id, type: "system", body: "Follow-up scheduled", metadata: { followUpDate } });
        await createLeadFollowUpTask(tx, firm.id, existing, ownerId, followUpDate);
      }
      return { id: updated!.id, action: "updated" };
    }

    const ownerId = await nextLeadOwner(tx, firm.id, firm.leadAssignmentCursor);
    const followUpDate = nextBusinessDay(now);

    const [lead] = await tx.insert(leads).values({
      firmId: firm.id,
      leadNumber: await nextNumber(tx, firm.id, "lead"),
      goHighLevelContactId: input.contactId,
      name: input.name,
      email,
      phone,
      company: input.company || null,
      source: "other",
      status: "new",
      ownerId,
      followUpDate,
      message: input.tags?.length ? `GoHighLevel tags: ${input.tags.slice(0, 30).join(", ")}`.slice(0, 2000) : null,
    }).returning({ id: leads.id });
    if (!lead) throw new Error("Could not create GoHighLevel lead.");
    await recordAudit(tx, { firmId: firm.id, actorUserId: null, action: "lead.gohighlevel_create", entityType: "lead", entityId: lead.id, metadata: { changedFields: ["source", "ownerId", "followUpDate"] } });
    await logActivity(tx, { firmId: firm.id, userId: null }, { entityType: "lead", entityId: lead.id, type: "system", body: "Lead received from GoHighLevel" });
    await recordStatusChange(tx, { firmId: firm.id, userId: null }, { entityType: "lead", entityId: lead.id, from: null, to: "new" });
    if (ownerId) await logActivity(tx, { firmId: firm.id, userId: null }, { entityType: "lead", entityId: lead.id, type: "assignment", metadata: { userId: ownerId, title: input.name } });
    await logActivity(tx, { firmId: firm.id, userId: null }, { entityType: "lead", entityId: lead.id, type: "system", body: "Follow-up scheduled", metadata: { followUpDate } });
    await createLeadFollowUpTask(tx, firm.id, { id: lead.id, name: input.name }, ownerId, followUpDate);
    return { id: lead.id, action: "created" };
  });
}
