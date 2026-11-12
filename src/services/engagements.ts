import { and, asc, desc, eq, ilike, inArray, isNotNull, lt, lte, notInArray, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "@/db";
import { clients, engagements, engagementTeam, tasks, users, type Engagement, type EngagementStatus, type Task } from "@/db/schema";
import { ASSIGNABLE_ROLES, type Actor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/permissions";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { ENGAGEMENT_DONE, ENGAGEMENT_PRE_WORK } from "@/lib/status";
import { engagementInputSchema, engagementTeamSchema, isUuid, parseInput } from "@/lib/validation";
import { recordAudit } from "./audit";
import { assertActiveStaffUser, assertClientAccess, ensureAssignment, inFirm, requireCanAssign, requirePermission, requireStaff, visibleClientsCondition } from "./access";
import { logActivity, nextNumber, recordStatusChange } from "./timeline";

/**
 * Engagements: a defined service arrangement for a client (e.g. "Annual Tax Preparation 2026").
 * Not a task — one client has many engagements, one engagement many tasks.
 *
 * Lifecycle: draft → proposal_sent → awaiting_acceptance → active → work stages
 * (not_started … in_review [Under review] … completed) → closed. Cancelled / on hold anytime.
 * Rules:
 *  - Work stages need the proposal accepted (or "not required"), unless a manager overrides.
 *  - Completing, cancelling and closing need the approve permission (managers/admins).
 *  - Closing needs the work to be completed (or filed / cancelled) first; closed is final.
 *  - Finishing every task never closes the engagement; it only flags it "ready for review".
 */

/** Hidden from the open engagements list. Filed stays visible until it is completed or closed. */
const CLOSED_STATUSES: EngagementStatus[] = ["completed", "cancelled", "closed"];
/** Statuses that mean work is under way (need an accepted proposal or a manager override). */
export const WORK_STAGES: EngagementStatus[] = ["not_started", "waiting_on_client", "in_progress", "in_review", "ready_to_file", "filed", "completed"];
const APPROVAL_STATUSES: EngagementStatus[] = ["completed", "cancelled", "closed"];

const TASK_OPEN_SQL = sql.raw(`('todo','in_progress','waiting_client','waiting_review','blocked')`);

export interface EngagementSummary {
  id: string;
  engagementNumber: number | null;
  title: string;
  status: EngagementStatus;
  serviceType: Engagement["serviceType"];
  taxYear: number | null;
  dueDate: string | null;
  startDate: string | null;
  priority: Engagement["priority"];
  proposalStatus: Engagement["proposalStatus"];
  feeCents: number | null;
  clientId: string;
  clientName: string;
  ownerId: string;
  ownerName: string;
  openTaskCount: number;
  totalTaskCount: number;
  completedTaskCount: number;
  overdueTaskCount: number;
}

const owner = alias(users, "owner");

function summarySelect(today?: string) {
  const counted = (cond: ReturnType<typeof sql>) =>
    sql<number>`(select count(*)::int from ${tasks} where ${tasks.engagementId} = ${engagements.id} and ${tasks.firmId} = ${engagements.firmId} and ${tasks.archivedAt} is null and ${cond})`;
  return {
    id: engagements.id,
    engagementNumber: engagements.engagementNumber,
    title: engagements.title,
    status: engagements.status,
    serviceType: engagements.serviceType,
    taxYear: engagements.taxYear,
    dueDate: engagements.dueDate,
    startDate: engagements.startDate,
    priority: engagements.priority,
    proposalStatus: engagements.proposalStatus,
    feeCents: engagements.feeCents,
    clientId: engagements.clientId,
    clientName: clients.displayName,
    ownerId: engagements.ownerId,
    ownerName: owner.name,
    openTaskCount: counted(sql`${tasks.status} in ${TASK_OPEN_SQL}`),
    totalTaskCount: counted(sql`${tasks.status} <> 'cancelled'`),
    completedTaskCount: counted(sql`${tasks.status} = 'completed'`),
    overdueTaskCount: today ? counted(sql`${tasks.status} in ${TASK_OPEN_SQL} and ${tasks.dueDate} < ${today}`) : sql<number>`0`,
  };
}

export interface EngagementFilters {
  q?: string;
  clientId?: string;
  serviceType?: Engagement["serviceType"];
  managerId?: string;
  staffId?: string;
  status?: EngagementStatus | "open" | "pre_work" | "done";
  taxYear?: number;
  due?: "overdue" | "30d";
  today?: string;
  ownedByMe?: boolean;
}

/** Engagements the actor can see, with task progress. Defaults to open work. */
export async function listEngagements(db: Db, actor: Actor, f: EngagementFilters = {}): Promise<EngagementSummary[]> {
  const visible = visibleClientsCondition(db, actor);
  const q = f.q?.trim().slice(0, 100);
  const like = q ? `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : undefined;
  const in30 = f.today ? new Date(Date.parse(`${f.today}T00:00:00Z`) + 30 * 86_400_000).toISOString().slice(0, 10) : undefined;
  const statusCond =
    f.status === "open" || !f.status
      ? notInArray(engagements.status, CLOSED_STATUSES)
      : f.status === "pre_work"
        ? inArray(engagements.status, [...ENGAGEMENT_PRE_WORK])
        : f.status === "done"
          ? inArray(engagements.status, [...ENGAGEMENT_DONE])
          : eq(engagements.status, f.status);
  return db
    .select(summarySelect(f.today))
    .from(engagements)
    .innerJoin(clients, eq(clients.id, engagements.clientId))
    .innerJoin(owner, eq(owner.id, engagements.ownerId))
    .where(
      and(
        inFirm(engagements.firmId, actor),
        visible,
        statusCond,
        like ? or(ilike(engagements.title, like), ilike(clients.displayName, like)) : undefined,
        f.clientId && isUuid(f.clientId) ? eq(engagements.clientId, f.clientId) : undefined,
        f.serviceType ? eq(engagements.serviceType, f.serviceType) : undefined,
        f.managerId && isUuid(f.managerId) ? eq(engagements.ownerId, f.managerId) : undefined,
        f.ownedByMe ? eq(engagements.ownerId, actor.userId) : undefined,
        f.staffId && isUuid(f.staffId)
          ? sql`exists (select 1 from ${engagementTeam} et where et.engagement_id = ${engagements.id} and et.firm_id = ${engagements.firmId} and et.user_id = ${f.staffId})`
          : undefined,
        f.taxYear ? eq(engagements.taxYear, f.taxYear) : undefined,
        f.due === "overdue" && f.today ? and(isNotNull(engagements.dueDate), lt(engagements.dueDate, f.today), notInArray(engagements.status, [...ENGAGEMENT_DONE])) : undefined,
        f.due === "30d" && f.today && in30 ? and(isNotNull(engagements.dueDate), lte(engagements.dueDate, in30), notInArray(engagements.status, [...ENGAGEMENT_DONE])) : undefined,
      ),
    )
    .orderBy(sql`${engagements.dueDate} asc nulls last`, asc(clients.displayName))
    .limit(1000);
}

/** Open engagements the actor can see, soonest due first (dashboard). */
export async function listOpenEngagements(db: Db, actor: Actor, opts: { ownedByMe?: boolean } = {}): Promise<EngagementSummary[]> {
  return (await listEngagements(db, actor, { status: "open", ownedByMe: opts.ownedByMe })).slice(0, 200);
}

export async function listClientEngagements(db: Db, actor: Actor, clientId: string): Promise<EngagementSummary[]> {
  await assertClientAccess(db, actor, clientId);
  return db
    .select(summarySelect())
    .from(engagements)
    .innerJoin(clients, eq(clients.id, engagements.clientId))
    .innerJoin(owner, eq(owner.id, engagements.ownerId))
    .where(and(inFirm(engagements.firmId, actor), eq(engagements.clientId, clientId)))
    .orderBy(desc(engagements.createdAt));
}

export interface TeamMember {
  userId: string;
  name: string;
  role: "manager" | "staff" | "reviewer";
}

export interface EngagementProgress {
  total: number;
  completed: number;
  open: number;
  overdue: number;
  percent: number;
  /** Every (non-cancelled) task is completed — the manager should review. Never closes anything. */
  readyForReview: boolean;
}

export interface EngagementDetail {
  engagement: Engagement;
  clientName: string;
  ownerName: string;
  team: TeamMember[];
  tasks: (Task & { assigneeName: string | null })[];
  progress: EngagementProgress;
  /** Work may start (proposal accepted / not required, or a manager override). */
  workAllowed: boolean;
}

export async function loadEngagementForStaff(db: Db, actor: Actor, engagementId: string): Promise<Engagement> {
  requireStaff(actor);
  if (!isUuid(engagementId)) throw new NotFoundError();
  const [engagement] = await db.select().from(engagements).where(and(eq(engagements.id, engagementId), inFirm(engagements.firmId, actor))).limit(1);
  if (!engagement) throw new NotFoundError();
  await assertClientAccess(db, actor, engagement.clientId);
  return engagement;
}

export function workAllowed(e: Pick<Engagement, "proposalStatus" | "workOverrideById">): boolean {
  return e.proposalStatus === "not_required" || e.proposalStatus === "accepted" || !!e.workOverrideById;
}

export function computeProgress(list: { status: Task["status"]; dueDate: string | null }[], today?: string): EngagementProgress {
  const counted = list.filter((t) => t.status !== "cancelled");
  const completed = counted.filter((t) => t.status === "completed").length;
  const open = counted.length - completed;
  const overdue = today ? counted.filter((t) => t.status !== "completed" && t.dueDate && t.dueDate < today).length : 0;
  return { total: counted.length, completed, open, overdue, percent: counted.length ? Math.round((completed / counted.length) * 100) : 0, readyForReview: counted.length > 0 && open === 0 };
}

export async function listEngagementTeam(db: Db, actor: Actor, engagementId: string): Promise<TeamMember[]> {
  return db
    .select({ userId: engagementTeam.userId, name: users.name, role: engagementTeam.role })
    .from(engagementTeam)
    .innerJoin(users, eq(users.id, engagementTeam.userId))
    .where(and(eq(engagementTeam.engagementId, engagementId), inFirm(engagementTeam.firmId, actor)))
    .orderBy(asc(engagementTeam.role), asc(users.name));
}

export async function getEngagement(db: Db, actor: Actor, engagementId: string, today?: string): Promise<EngagementDetail> {
  const engagement = await loadEngagementForStaff(db, actor, engagementId);
  const [names] = await db
    .select({ clientName: clients.displayName, ownerName: owner.name })
    .from(clients)
    .innerJoin(owner, eq(owner.id, engagement.ownerId))
    .where(and(eq(clients.id, engagement.clientId), inFirm(clients.firmId, actor)));
  const assignee = alias(users, "assignee");
  const taskRows = await db
    .select({ task: tasks, assigneeName: assignee.name })
    .from(tasks)
    .leftJoin(assignee, eq(assignee.id, tasks.assigneeId))
    .where(and(eq(tasks.engagementId, engagement.id), inFirm(tasks.firmId, actor), sql`${tasks.archivedAt} is null`))
    .orderBy(sql`${tasks.sequence} asc nulls last`, sql`${tasks.dueDate} asc nulls last`, asc(tasks.createdAt));
  const list = taskRows.map((r) => ({ ...r.task, assigneeName: r.assigneeName }));
  return {
    engagement,
    clientName: names?.clientName ?? "",
    ownerName: names?.ownerName ?? "",
    team: await listEngagementTeam(db, actor, engagement.id),
    tasks: list,
    progress: computeProgress(list, today),
    workAllowed: workAllowed(engagement),
  };
}

function initialStatus(proposalStatus: Engagement["proposalStatus"], requested?: EngagementStatus): EngagementStatus {
  if (requested) return requested;
  if (proposalStatus === "draft") return "draft";
  if (proposalStatus === "sent") return "awaiting_acceptance";
  if (proposalStatus === "declined") return "cancelled";
  return "active";
}

function assertWorkAllowed(e: Pick<Engagement, "proposalStatus" | "workOverrideById">, to: EngagementStatus) {
  if (WORK_STAGES.includes(to) && !workAllowed(e)) {
    throw new ValidationError(
      { status: ["Work can’t start until the client accepts the proposal. A manager can record the acceptance or allow work to start."] },
      "The proposal hasn’t been accepted yet.",
    );
  }
}

async function addTeamMembers(db: Db, actor: Actor, e: Pick<Engagement, "id" | "clientId" | "title">, members: { userId: string; role: TeamMember["role"] }[]) {
  for (const m of members) {
    await db
      .insert(engagementTeam)
      .values({ firmId: actor.firmId, engagementId: e.id, userId: m.userId, role: m.role })
      .onConflictDoUpdate({ target: [engagementTeam.engagementId, engagementTeam.userId], set: { role: m.role } });
    // Team members must be able to open the client.
    await ensureAssignment(db, actor.firmId, e.clientId, m.userId);
    // Shows up in the assignee's notifications (services/workspace.ts).
    await logActivity(db, actor, { entityType: "engagement", entityId: e.id, clientId: e.clientId, type: "assignment", metadata: { userId: m.userId, role: m.role, title: e.title } });
  }
}

export async function createEngagement(db: Db, actor: Actor, clientId: string, input: unknown): Promise<Engagement> {
  requirePermission(actor, "engagements", "create");
  await assertClientAccess(db, actor, clientId);
  const data = parseInput(engagementInputSchema, input);
  requireCanAssign(actor, data.ownerId);
  await assertActiveStaffUser(db, actor, data.ownerId, "ownerId");
  const staffIds = [...new Set(data.staffIds)].filter((id) => id !== data.ownerId);
  if (staffIds.length) requirePermission(actor, "engagements", "assign");
  for (const id of staffIds) await assertActiveStaffUser(db, actor, id, "staffIds");
  const status = initialStatus(data.proposalStatus, data.status);
  if (data.proposalStatus === "accepted" && !data.acceptedOn) data.acceptedOn = new Date().toISOString().slice(0, 10);
  assertWorkAllowed({ proposalStatus: data.proposalStatus, workOverrideById: null }, status);

  return db.transaction(async (txRaw) => {
    const t = txRaw as unknown as Db;
    const [engagement] = await t
      .insert(engagements)
      .values({
        firmId: actor.firmId,
        clientId,
        engagementNumber: await nextNumber(t, actor.firmId, "engagement"),
        title: data.title,
        serviceType: data.serviceType,
        description: data.description ?? null,
        taxYear: data.taxYear ?? null,
        periodStart: data.periodStart ?? null,
        periodEnd: data.periodEnd ?? null,
        startDate: data.startDate ?? null,
        dueDate: data.dueDate ?? null,
        ownerId: data.ownerId,
        status,
        priority: data.priority,
        proposalStatus: data.proposalStatus,
        acceptedOn: data.acceptedOn ?? null,
        feeCents: data.feeCents ?? null,
        billingFrequency: data.billingFrequency ?? null,
        createdById: actor.userId,
      })
      .returning();
    if (!engagement) throw new Error("Insert returned no row");
    await addTeamMembers(t, actor, engagement, [{ userId: data.ownerId, role: "manager" }, ...staffIds.map((userId) => ({ userId, role: "staff" as const }))]);
    await recordAudit(t, { firmId: actor.firmId, actorUserId: actor.userId, action: "engagement.create", entityType: "engagement", entityId: engagement.id, metadata: { clientId } });
    await recordAudit(t, { firmId: actor.firmId, actorUserId: actor.userId, action: "client.assign", entityType: "client", entityId: clientId, metadata: { userId: data.ownerId, reason: "engagement_owner" } });
    await logActivity(t, actor, { entityType: "engagement", entityId: engagement.id, clientId, type: "system", body: `Engagement created: ${engagement.title}` });
    await recordStatusChange(t, actor, { entityType: "engagement", entityId: engagement.id, clientId, from: null, to: status });
    return engagement;
  });
}

export async function updateEngagement(db: Db, actor: Actor, engagementId: string, input: unknown): Promise<Engagement> {
  requirePermission(actor, "engagements", "edit");
  const existing = await loadEngagementForStaff(db, actor, engagementId);
  if (existing.status === "closed") throw new ValidationError({ _form: ["Closed engagements can’t be changed."] });
  const data = parseInput(engagementInputSchema, input);
  if (data.ownerId !== existing.ownerId) {
    requirePermission(actor, "engagements", "assign");
    requireCanAssign(actor, data.ownerId);
    await assertActiveStaffUser(db, actor, data.ownerId, "ownerId");
  }
  const next = {
    title: data.title,
    serviceType: data.serviceType,
    description: data.description ?? null,
    taxYear: data.taxYear ?? null,
    periodStart: data.periodStart ?? null,
    periodEnd: data.periodEnd ?? null,
    startDate: data.startDate ?? null,
    dueDate: data.dueDate ?? null,
    ownerId: data.ownerId,
    priority: data.priority,
    feeCents: data.feeCents ?? null,
    billingFrequency: data.billingFrequency ?? null,
  };
  const changed = (Object.keys(next) as (keyof typeof next)[]).filter((k) => next[k] !== existing[k]);
  const statusChange = data.status && data.status !== existing.status ? data.status : null;
  if (!changed.length && !statusChange) return existing;

  const updated = await db.transaction(async (txRaw) => {
    const t = txRaw as unknown as Db;
    const [row] = await t
      .update(engagements)
      .set({ ...next, updatedAt: new Date() })
      .where(and(eq(engagements.id, engagementId), inFirm(engagements.firmId, actor)))
      .returning();
    if (!row) throw new NotFoundError();
    if (changed.includes("ownerId")) {
      await addTeamMembers(t, actor, row, [{ userId: data.ownerId, role: "manager" }]);
      await recordAudit(t, { firmId: actor.firmId, actorUserId: actor.userId, action: "client.assign", entityType: "client", entityId: existing.clientId, metadata: { userId: data.ownerId, reason: "engagement_owner", engagementId } });
    }
    if (changed.length) {
      await recordAudit(t, { firmId: actor.firmId, actorUserId: actor.userId, action: "engagement.update", entityType: "engagement", entityId: engagementId, metadata: { changedFields: changed } });
      await logActivity(t, actor, { entityType: "engagement", entityId: engagementId, clientId: existing.clientId, type: "system", body: "Engagement details updated", metadata: { changedFields: changed } });
    }
    return row;
  });
  if (statusChange) await setEngagementStatus(db, actor, engagementId, statusChange);
  return statusChange ? (await loadEngagementForStaff(db, actor, engagementId)) : updated;
}

/** Validated status change (detail page, kanban, bulk). Records history. */
export async function setEngagementStatus(db: Db, actor: Actor, engagementId: string, status: EngagementStatus, note?: string): Promise<void> {
  requirePermission(actor, "engagements", "edit");
  const existing = await loadEngagementForStaff(db, actor, engagementId);
  if (!engagements.status.enumValues.includes(status)) throw new ValidationError({ status: ["Choose a status."] });
  if (existing.status === status) return;
  if (existing.status === "closed") throw new ValidationError({ status: ["Closed engagements can’t be reopened."] });
  if (APPROVAL_STATUSES.includes(status) && !can(actor, "engagements", "approve")) {
    throw new ForbiddenError("Only a manager or admin can complete, cancel or close an engagement.");
  }
  if (status === "closed" && !["completed", "filed", "cancelled"].includes(existing.status)) {
    throw new ValidationError({ status: ["Complete the engagement (after review) before closing it."] });
  }
  assertWorkAllowed(existing, status);
  const now = new Date();
  await db.transaction(async (txRaw) => {
    const t = txRaw as unknown as Db;
    await t
      .update(engagements)
      .set({
        status,
        ...(status === "completed" || status === "filed" ? { completedAt: existing.completedAt ?? now } : {}),
        ...(status === "closed" ? { closedAt: now } : {}),
        updatedAt: now,
      })
      .where(and(eq(engagements.id, engagementId), inFirm(engagements.firmId, actor)));
    await recordStatusChange(t, actor, { entityType: "engagement", entityId: engagementId, clientId: existing.clientId, from: existing.status, to: status, note });
    await recordAudit(t, { firmId: actor.firmId, actorUserId: actor.userId, action: "engagement.update", entityType: "engagement", entityId: engagementId, metadata: { changedFields: ["status"], from: existing.status, to: status } });
  });
}

/** Proposal sent / accepted / declined. Acceptance (approve permission) opens the engagement for work. */
export async function setProposalStatus(db: Db, actor: Actor, engagementId: string, proposal: "draft" | "sent" | "accepted" | "declined", acceptedOn?: string): Promise<void> {
  requirePermission(actor, "engagements", "edit");
  if (proposal === "accepted" || proposal === "declined") requirePermission(actor, "engagements", "approve");
  const e = await loadEngagementForStaff(db, actor, engagementId);
  if (e.status === "closed") throw new ValidationError({ _form: ["Closed engagements can’t be changed."] });
  if (e.proposalStatus === proposal) return;
  const today = new Date().toISOString().slice(0, 10);
  const nextStatus: EngagementStatus | null =
    proposal === "sent" && ENGAGEMENT_PRE_WORK.includes(e.status)
      ? "awaiting_acceptance"
      : proposal === "accepted" && ENGAGEMENT_PRE_WORK.includes(e.status)
        ? "active"
        : proposal === "declined"
          ? "cancelled"
          : null;
  await db.transaction(async (txRaw) => {
    const t = txRaw as unknown as Db;
    await t
      .update(engagements)
      .set({ proposalStatus: proposal, acceptedOn: proposal === "accepted" ? (acceptedOn ?? today) : e.acceptedOn, ...(nextStatus ? { status: nextStatus } : {}), updatedAt: new Date() })
      .where(and(eq(engagements.id, engagementId), inFirm(engagements.firmId, actor)));
    await logActivity(t, actor, { entityType: "engagement", entityId: engagementId, clientId: e.clientId, type: "system", body: `Proposal ${proposal}`, metadata: { field: "proposal", from: e.proposalStatus, to: proposal } });
    if (nextStatus) await recordStatusChange(t, actor, { entityType: "engagement", entityId: engagementId, clientId: e.clientId, from: e.status, to: nextStatus, note: `Proposal ${proposal}` });
  });
}

/** A manager lets work start before the proposal is accepted (recorded on the timeline). */
export async function overrideWorkStart(db: Db, actor: Actor, engagementId: string, reason: string): Promise<void> {
  requirePermission(actor, "engagements", "approve");
  const e = await loadEngagementForStaff(db, actor, engagementId);
  if (workAllowed(e)) return;
  const why = reason.trim().slice(0, 500);
  if (!why) throw new ValidationError({ reason: ["Say why work can start before acceptance."] });
  await db.update(engagements).set({ workOverrideById: actor.userId, updatedAt: new Date() }).where(and(eq(engagements.id, engagementId), inFirm(engagements.firmId, actor)));
  await logActivity(db, actor, { entityType: "engagement", entityId: engagementId, clientId: e.clientId, type: "system", body: `Work allowed to start before acceptance: ${why}` });
  await recordAudit(db, { firmId: actor.firmId, actorUserId: actor.userId, action: "engagement.override", entityType: "engagement", entityId: engagementId });
}

/** Replaces the engagement team (the engagement manager always stays as manager). */
export async function setEngagementTeam(db: Db, actor: Actor, engagementId: string, input: unknown): Promise<TeamMember[]> {
  requirePermission(actor, "engagements", "assign");
  const e = await loadEngagementForStaff(db, actor, engagementId);
  const { members } = parseInput(engagementTeamSchema, input);
  const unique = new Map(members.filter((m) => m.userId !== e.ownerId).map((m) => [m.userId, m]));
  for (const m of unique.values()) await assertActiveStaffUser(db, actor, m.userId, "members");
  await db.transaction(async (txRaw) => {
    const t = txRaw as unknown as Db;
    const before = await listEngagementTeam(t, actor, engagementId);
    const keep = new Set([e.ownerId, ...unique.keys()]);
    for (const old of before) {
      if (!keep.has(old.userId)) {
        await t.delete(engagementTeam).where(and(eq(engagementTeam.engagementId, engagementId), eq(engagementTeam.userId, old.userId), inFirm(engagementTeam.firmId, actor)));
        await logActivity(t, actor, { entityType: "engagement", entityId: engagementId, clientId: e.clientId, type: "system", body: `${old.name} removed from the team` });
      }
    }
    const toAdd: { userId: string; role: TeamMember["role"] }[] = [];
    if (!before.some((b) => b.userId === e.ownerId)) toAdd.push({ userId: e.ownerId, role: "manager" });
    toAdd.push(...[...unique.values()].filter((m) => !before.some((b) => b.userId === m.userId && b.role === m.role)));
    await addTeamMembers(t, actor, e, toAdd);
  });
  return listEngagementTeam(db, actor, engagementId);
}

/** Active staff for owner/assignee pickers (read-only users can't own work). */
export async function listStaff(db: Db, actor: Actor) {
  requireStaff(actor);
  return db
    .select({ id: users.id, name: users.name, role: users.role })
    .from(users)
    .where(and(inFirm(users.firmId, actor), eq(users.isActive, true), inArray(users.role, ASSIGNABLE_ROLES)))
    .orderBy(asc(users.name));
}

// Task operations live in ./tasks; re-exported for existing callers.
export { createEngagementTask as createTask, setTaskStatus } from "./tasks";
