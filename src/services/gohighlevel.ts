import { and, eq, or, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { firms, leads } from "@/db/schema";
import { recordAudit } from "@/services/audit";
import { nextNumber, logActivity, recordStatusChange } from "@/services/timeline";

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
  const [firm] = await db.select({ id: firms.id }).from(firms).where(eq(firms.id, firmId)).limit(1);
  if (!firm) throw new Error("No firm is configured for GoHighLevel lead sync.");

  const email = normalizedEmail(input.email);
  const phone = normalizedPhone(input.phone);
  return db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Db;
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
      const [updated] = await tx.update(leads).set({
        goHighLevelContactId: input.contactId,
        name: input.name,
        ...(email ? { email } : {}),
        ...(phone ? { phone } : {}),
        ...(input.company ? { company: input.company } : {}),
        updatedAt: now,
      }).where(eq(leads.id, existing.id)).returning({ id: leads.id });
      await recordAudit(tx, { firmId: firm.id, actorUserId: null, action: "lead.gohighlevel_update", entityType: "lead", entityId: existing.id });
      return { id: updated!.id, action: "updated" };
    }

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
      message: input.tags?.length ? `GoHighLevel tags: ${input.tags.slice(0, 30).join(", ")}`.slice(0, 2000) : null,
    }).returning({ id: leads.id });
    if (!lead) throw new Error("Could not create GoHighLevel lead.");
    await recordAudit(tx, { firmId: firm.id, actorUserId: null, action: "lead.gohighlevel_create", entityType: "lead", entityId: lead.id });
    await logActivity(tx, { firmId: firm.id, userId: null }, { entityType: "lead", entityId: lead.id, type: "system", body: "Lead received from GoHighLevel" });
    await recordStatusChange(tx, { firmId: firm.id, userId: null }, { entityType: "lead", entityId: lead.id, from: null, to: "new" });
    return { id: lead.id, action: "created" };
  });
}
