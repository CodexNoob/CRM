import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db";
import { taskDependencies, tasks, workflowInstances, workflowTemplates, workflowTemplateTasks, type ServiceType } from "@/db/schema";
import type { Actor } from "@/lib/auth/actor";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { isUuid, parseInput, templateInputSchema, workflowGenerationSchema } from "@/lib/validation";
import { assertActiveStaffUser, ensureAssignment, inFirm, requirePermission, requireStaff } from "./access";
import { recordAudit } from "./audit";
import { listEngagementTeam, loadEngagementForStaff } from "./engagements";
import { logActivity, nextNumber, recordStatusChange } from "./timeline";

/**
 * Workflow templates: reusable task sequences per service. A manager picks a template for an
 * engagement, reviews the generated task list (assignees and due dates), and confirms.
 * Generation is transactional and unique per (engagement, template) — a double click or a
 * second attempt never creates a duplicate task set.
 */

type Step = {
  title: string;
  description?: string;
  defaultPriority?: "low" | "normal" | "high" | "urgent";
  relativeDueDays?: number;
  defaultAssignee?: "manager" | "staff" | "reviewer" | "unassigned";
  dependsOnSequence?: number;
  isClientTask?: boolean;
};

/** Built-in templates every firm starts with (editable copies, created on first use). */
export const DEFAULT_TEMPLATES: { name: string; description: string; serviceType: ServiceType; steps: Step[] }[] = [
  {
    name: "Annual Tax Preparation",
    description: "Individual or business income tax return, from document request to filing.",
    serviceType: "individual_tax",
    steps: [
      { title: "Request tax documents", relativeDueDays: 3, defaultAssignee: "staff" },
      { title: "Verify client information", relativeDueDays: 10, defaultAssignee: "staff", dependsOnSequence: 1 },
      { title: "Review income statements", relativeDueDays: 14, defaultAssignee: "staff", dependsOnSequence: 2 },
      { title: "Review expenses and deductions", relativeDueDays: 17, defaultAssignee: "staff", dependsOnSequence: 2 },
      { title: "Prepare tax return", relativeDueDays: 21, defaultAssignee: "staff", dependsOnSequence: 4, defaultPriority: "high" },
      { title: "Internal quality review", relativeDueDays: 24, defaultAssignee: "reviewer", dependsOnSequence: 5, defaultPriority: "high" },
      { title: "Send return for client approval", relativeDueDays: 26, defaultAssignee: "manager", dependsOnSequence: 6 },
      { title: "Complete filing", relativeDueDays: 30, defaultAssignee: "staff", dependsOnSequence: 7, defaultPriority: "high" },
      { title: "Confirm filing completion", relativeDueDays: 33, defaultAssignee: "staff", dependsOnSequence: 8 },
      { title: "Close engagement", relativeDueDays: 35, defaultAssignee: "manager", dependsOnSequence: 9 },
    ],
  },
  {
    name: "Monthly Bookkeeping",
    description: "One month of bookkeeping: collect, categorize, reconcile, review and report.",
    serviceType: "bookkeeping",
    steps: [
      { title: "Request monthly financial documents", relativeDueDays: 2, defaultAssignee: "staff" },
      { title: "Collect bank statements", relativeDueDays: 5, defaultAssignee: "staff", dependsOnSequence: 1 },
      { title: "Review transactions", relativeDueDays: 8, defaultAssignee: "staff", dependsOnSequence: 2 },
      { title: "Categorize transactions", relativeDueDays: 10, defaultAssignee: "staff", dependsOnSequence: 3 },
      { title: "Reconcile accounts", relativeDueDays: 12, defaultAssignee: "staff", dependsOnSequence: 4, defaultPriority: "high" },
      { title: "Review bookkeeping records", relativeDueDays: 14, defaultAssignee: "reviewer", dependsOnSequence: 5 },
      { title: "Prepare monthly financial reports", relativeDueDays: 16, defaultAssignee: "staff", dependsOnSequence: 6 },
      { title: "Deliver reports to client", relativeDueDays: 18, defaultAssignee: "manager", dependsOnSequence: 7 },
    ],
  },
];

/** Creates the default templates for a firm that has none yet (idempotent). */
export async function ensureDefaultTemplates(db: Db, actor: Pick<Actor, "firmId" | "userId">): Promise<void> {
  const [any] = await db.select({ id: workflowTemplates.id }).from(workflowTemplates).where(eq(workflowTemplates.firmId, actor.firmId)).limit(1);
  if (any) return;
  await db.transaction(async (txRaw) => {
    const t = txRaw as unknown as Db;
    for (const tpl of DEFAULT_TEMPLATES) {
      const [row] = await t.insert(workflowTemplates).values({ firmId: actor.firmId, name: tpl.name, description: tpl.description, serviceType: tpl.serviceType, createdById: actor.userId }).returning({ id: workflowTemplates.id });
      await t.insert(workflowTemplateTasks).values(
        tpl.steps.map((s, i) => ({
          firmId: actor.firmId,
          templateId: row!.id,
          sequence: i + 1,
          title: s.title,
          description: s.description ?? null,
          defaultPriority: s.defaultPriority ?? "normal",
          relativeDueDays: s.relativeDueDays ?? null,
          defaultAssignee: s.defaultAssignee ?? "staff",
          dependsOnSequence: s.dependsOnSequence ?? null,
          isClientTask: s.isClientTask ?? false,
        })),
      );
    }
  });
}

export async function listTemplates(db: Db, actor: Actor, opts: { activeOnly?: boolean } = {}) {
  requirePermission(actor, "templates", "view");
  await ensureDefaultTemplates(db, actor);
  const rows = await db
    .select()
    .from(workflowTemplates)
    .where(and(inFirm(workflowTemplates.firmId, actor), opts.activeOnly ? eq(workflowTemplates.isActive, true) : undefined))
    .orderBy(asc(workflowTemplates.name));
  const steps = rows.length
    ? await db.select().from(workflowTemplateTasks).where(and(inFirm(workflowTemplateTasks.firmId, actor), inArray(workflowTemplateTasks.templateId, rows.map((r) => r.id)))).orderBy(asc(workflowTemplateTasks.sequence))
    : [];
  return rows.map((r) => ({ ...r, steps: steps.filter((s) => s.templateId === r.id) }));
}

async function loadTemplate(db: Db, actor: Actor, templateId: string) {
  if (!isUuid(templateId)) throw new NotFoundError();
  const [tpl] = await db.select().from(workflowTemplates).where(and(eq(workflowTemplates.id, templateId), inFirm(workflowTemplates.firmId, actor)));
  if (!tpl) throw new NotFoundError();
  const steps = await db.select().from(workflowTemplateTasks).where(and(eq(workflowTemplateTasks.templateId, templateId), inFirm(workflowTemplateTasks.firmId, actor))).orderBy(asc(workflowTemplateTasks.sequence));
  return { ...tpl, steps };
}

function validateSteps(steps: { dependsOnSequence?: number }[]) {
  steps.forEach((s, i) => {
    if (s.dependsOnSequence !== undefined && (s.dependsOnSequence < 1 || s.dependsOnSequence > i)) {
      throw new ValidationError({ steps: [`Step ${i + 1} can only depend on an earlier step.`] });
    }
  });
}

/** Creates or replaces a template (steps are replaced; tasks already generated keep their history). */
export async function saveTemplate(db: Db, actor: Actor, templateId: string | null, input: unknown) {
  requirePermission(actor, "templates", templateId ? "edit" : "create");
  const d = parseInput(templateInputSchema, input);
  validateSteps(d.steps);
  return db.transaction(async (txRaw) => {
    const t = txRaw as unknown as Db;
    let id = templateId;
    if (id) {
      await loadTemplate(t, actor, id);
      await t.update(workflowTemplates).set({ name: d.name, description: d.description ?? null, serviceType: d.serviceType, isActive: d.isActive, updatedAt: new Date() }).where(and(eq(workflowTemplates.id, id), inFirm(workflowTemplates.firmId, actor)));
      await t.delete(workflowTemplateTasks).where(and(eq(workflowTemplateTasks.templateId, id), inFirm(workflowTemplateTasks.firmId, actor)));
    } else {
      const [row] = await t.insert(workflowTemplates).values({ firmId: actor.firmId, name: d.name, description: d.description ?? null, serviceType: d.serviceType, isActive: d.isActive, createdById: actor.userId }).returning({ id: workflowTemplates.id });
      id = row!.id;
    }
    await t.insert(workflowTemplateTasks).values(
      d.steps.map((s, i) => ({
        firmId: actor.firmId,
        templateId: id!,
        sequence: i + 1,
        title: s.title,
        description: s.description ?? null,
        defaultPriority: s.defaultPriority,
        relativeDueDays: s.relativeDueDays ?? null,
        defaultAssignee: s.defaultAssignee,
        dependsOnSequence: s.dependsOnSequence ?? null,
        isClientTask: s.isClientTask,
      })),
    );
    await recordAudit(t, { firmId: actor.firmId, actorUserId: actor.userId, action: templateId ? "template.update" : "template.create", entityType: "workflow_template", entityId: id });
    return { id: id! };
  });
}

export async function setTemplateActive(db: Db, actor: Actor, templateId: string, active: boolean): Promise<void> {
  requirePermission(actor, "templates", "manage");
  await loadTemplate(db, actor, templateId);
  await db.update(workflowTemplates).set({ isActive: active, updatedAt: new Date() }).where(and(eq(workflowTemplates.id, templateId), inFirm(workflowTemplates.firmId, actor)));
}

export interface PlannedTask {
  sequence: number;
  title: string;
  description: string | null;
  priority: "low" | "normal" | "high" | "urgent";
  dueDate: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  isClientTask: boolean;
  dependsOnSequence: number | null;
}

function addDays(iso: string, days: number) {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** What generating this template on this engagement would create (nothing is written). */
export async function previewWorkflow(db: Db, actor: Actor, engagementId: string, templateId: string, today = new Date().toISOString().slice(0, 10)) {
  requireStaff(actor);
  const e = await loadEngagementForStaff(db, actor, engagementId);
  if (["closed", "cancelled", "completed"].includes(e.status)) throw new ValidationError({ _form: ["Tasks can’t be generated for a finished engagement."] });
  const tpl = await loadTemplate(db, actor, templateId);
  if (!tpl.isActive) throw new ValidationError({ templateId: ["This template is inactive."] });
  const [already] = await db.select({ id: workflowInstances.id }).from(workflowInstances).where(and(eq(workflowInstances.engagementId, e.id), eq(workflowInstances.templateId, tpl.id), inFirm(workflowInstances.firmId, actor)));
  const team = await listEngagementTeam(db, actor, e.id);
  const pick = (role: "manager" | "staff" | "reviewer" | "unassigned") => {
    if (role === "unassigned") return null;
    if (role === "manager") return team.find((m) => m.userId === e.ownerId) ?? null;
    return team.find((m) => m.role === role) ?? (role === "reviewer" ? (team.find((m) => m.userId === e.ownerId) ?? null) : (team.find((m) => m.role === "staff") ?? null));
  };
  const base = e.startDate && e.startDate > today ? e.startDate : today;
  const planned: PlannedTask[] = tpl.steps.map((s) => {
    const who = s.isClientTask ? null : pick(s.defaultAssignee);
    return {
      sequence: s.sequence,
      title: s.title,
      description: s.description,
      priority: s.defaultPriority,
      dueDate: s.relativeDueDays !== null ? addDays(base, s.relativeDueDays) : null,
      assigneeId: who?.userId ?? null,
      assigneeName: who?.name ?? null,
      isClientTask: s.isClientTask,
      dependsOnSequence: s.dependsOnSequence,
    };
  });
  return { engagement: e, template: tpl, planned, alreadyGenerated: !!already };
}

export class DuplicateWorkflowError extends ValidationError {
  constructor() {
    super({ templateId: ["These tasks were already generated for this engagement."] }, "This workflow was already generated for this engagement.");
  }
}

/**
 * Creates the engagement's tasks from a template, with the reviewed assignees/due dates.
 * Links every task to the engagement, its client and the workflow instance; recreates
 * the template's dependencies between the generated tasks.
 */
export async function generateWorkflow(db: Db, actor: Actor, engagementId: string, input: unknown, today = new Date().toISOString().slice(0, 10)) {
  requirePermission(actor, "engagements", "manage");
  const d = parseInput(workflowGenerationSchema, input);
  const preview = await previewWorkflow(db, actor, engagementId, d.templateId, today);
  if (preview.alreadyGenerated) throw new DuplicateWorkflowError();
  const overrides = new Map(d.overrides.map((o) => [o.sequence, o]));
  for (const o of d.overrides) if (o.assigneeId) await assertActiveStaffUser(db, actor, o.assigneeId, "overrides");
  const e = preview.engagement;

  try {
    return await db.transaction(async (txRaw) => {
      const t = txRaw as unknown as Db;
      // The unique (engagement, template) index makes a concurrent second attempt fail here.
      const [instance] = await t
        .insert(workflowInstances)
        .values({ firmId: actor.firmId, templateId: preview.template.id, templateName: preview.template.name, engagementId: e.id, createdById: actor.userId })
        .returning();
      const bySeq = new Map<number, string>();
      const created: string[] = [];
      for (const p of preview.planned) {
        const o = overrides.get(p.sequence);
        if (o?.skip) continue;
        const assigneeId = p.isClientTask ? null : o && o.assigneeId !== undefined ? (o.assigneeId ?? null) : p.assigneeId;
        const [task] = await t
          .insert(tasks)
          .values({
            firmId: actor.firmId,
            taskNumber: await nextNumber(t, actor.firmId, "task"),
            engagementId: e.id,
            clientId: e.clientId,
            workflowInstanceId: instance!.id,
            sequence: p.sequence,
            title: p.title,
            description: p.description,
            isClientTask: p.isClientTask,
            priority: p.priority,
            dueDate: o?.dueDate ?? p.dueDate,
            assigneeId,
            assignedById: assigneeId ? actor.userId : null,
          })
          .returning({ id: tasks.id });
        bySeq.set(p.sequence, task!.id);
        created.push(task!.id);
        if (assigneeId) {
          await ensureAssignment(t, actor.firmId, e.clientId, assigneeId);
          await logActivity(t, actor, { entityType: "task", entityId: task!.id, clientId: e.clientId, type: "assignment", metadata: { userId: assigneeId, title: p.title, engagementId: e.id } });
        }
        await recordStatusChange(t, actor, { entityType: "task", entityId: task!.id, clientId: e.clientId, from: null, to: "todo", note: `Generated from ${preview.template.name}` });
      }
      for (const p of preview.planned) {
        const id = bySeq.get(p.sequence);
        const dep = p.dependsOnSequence ? bySeq.get(p.dependsOnSequence) : undefined;
        if (id && dep) await t.insert(taskDependencies).values({ firmId: actor.firmId, taskId: id, dependsOnTaskId: dep });
      }
      await logActivity(t, actor, { entityType: "engagement", entityId: e.id, clientId: e.clientId, type: "system", body: `Generated ${created.length} tasks from “${preview.template.name}”`, metadata: { workflowInstanceId: instance!.id } });
      await recordAudit(t, { firmId: actor.firmId, actorUserId: actor.userId, action: "workflow.generate", entityType: "engagement", entityId: e.id, metadata: { templateId: preview.template.id, tasks: created.length } });
      return { workflowInstanceId: instance!.id, taskIds: created };
    });
  } catch (error) {
    const code = (error as { code?: string; cause?: { code?: string } })?.code ?? (error as { cause?: { code?: string } })?.cause?.code;
    if (code === "23505") throw new DuplicateWorkflowError();
    throw error;
  }
}

/** Workflows already generated on an engagement (for its Tasks tab). */
export async function listEngagementWorkflows(db: Db, actor: Actor, engagementId: string) {
  await loadEngagementForStaff(db, actor, engagementId);
  return db.select().from(workflowInstances).where(and(eq(workflowInstances.engagementId, engagementId), inFirm(workflowInstances.firmId, actor))).orderBy(asc(workflowInstances.createdAt));
}
