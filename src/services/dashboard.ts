import { TASK_OPEN, ENGAGEMENT_DONE, ENGAGEMENT_OPEN, LEAD_OPEN } from "@/lib/status";
import { and, asc, desc, eq, gte, isNotNull, isNull, lt, lte, notInArray, or, sql, inArray, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "@/db";
import { clients, engagements, leads, onboardingItems, tasks, users, type EngagementStatus, type LeadStatus, type ServiceType, type TaskStatus } from "@/db/schema";
import { seesAllClients, type Actor } from "@/lib/auth/actor";
import { inFirm, requireStaff, visibleClientsCondition } from "./access";

/** Statuses that need no further work. Everything else counts as open. */
const DONE: EngagementStatus[] = [...ENGAGEMENT_DONE];
export const DUE_SOON_DAYS = 14;

/** The firm's calendar date, so "overdue" flips at the firm's midnight, not the server's. */
export function firmToday(now = new Date(), timeZone = process.env.FIRM_TIMEZONE || "America/New_York"): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface Dashboard {
  today: string;
  scope: "mine" | "all";
  metrics: { open: number; overdue: number; dueSoon: number; waitingOnClient: number; myOpenTasks: number; activeClients: number };
  statusBreakdown: { status: EngagementStatus; count: number }[];
  deadlines: { id: string; title: string; clientId: string; clientName: string; ownerName: string; status: EngagementStatus; dueDate: string }[];
  myTasks: {
    id: string;
    title: string;
    dueDate: string | null;
    engagementId: string;
    engagementTitle: string;
    clientName: string;
  }[];
  recentClients: { id: string; displayName: string; type: string; createdAt: Date }[];
}

export async function getDashboard(db: Db, actor: Actor, opts: { mine?: boolean; now?: Date } = {}): Promise<Dashboard> {
  requireStaff(actor);
  const today = firmToday(opts.now);
  const soon = addDays(today, DUE_SOON_DAYS);
  const visible = visibleClientsCondition(db, actor);
  const mine = opts.mine ? eq(engagements.ownerId, actor.userId) : undefined;
  const open = notInArray(engagements.status, DONE);
  const engFirm = inFirm(engagements.firmId, actor);
  const base = and(engFirm, visible, mine);
  const taskFirm = and(inFirm(tasks.firmId, actor), engFirm);

  const count = sql<number>`count(*)::int`;
  const scoped = () => db.select({ n: count }).from(engagements).innerJoin(clients, eq(clients.id, engagements.clientId));

  const owner = alias(users, "owner");
  const [openRow, overdueRow, soonRow, waitingRow, myTasksRow, clientsRow, breakdown, deadlines, myTasks, recentClients] = await Promise.all([
    scoped().where(and(base, open)),
    scoped().where(and(base, open, isNotNull(engagements.dueDate), lt(engagements.dueDate, today))),
    scoped().where(and(base, open, gte(engagements.dueDate, today), lte(engagements.dueDate, soon))),
    scoped().where(and(base, eq(engagements.status, "waiting_on_client"))),
    db
      .select({ n: count })
      .from(tasks)
      .innerJoin(engagements, eq(engagements.id, tasks.engagementId))
      .innerJoin(clients, eq(clients.id, engagements.clientId))
      .where(and(taskFirm, visible, eq(tasks.assigneeId, actor.userId), inArray(tasks.status, TASK_OPEN))),
    db.select({ n: count }).from(clients).where(and(visible, eq(clients.status, "active"))),
    db
      .select({ status: engagements.status, count })
      .from(engagements)
      .innerJoin(clients, eq(clients.id, engagements.clientId))
      .where(and(base, open))
      .groupBy(engagements.status),
    db
      .select({
        id: engagements.id,
        title: engagements.title,
        clientId: clients.id,
        clientName: clients.displayName,
        ownerName: owner.name,
        status: engagements.status,
        dueDate: sql<string>`${engagements.dueDate}`,
      })
      .from(engagements)
      .innerJoin(clients, eq(clients.id, engagements.clientId))
      .innerJoin(owner, eq(owner.id, engagements.ownerId))
      .where(and(base, open, isNotNull(engagements.dueDate), lte(engagements.dueDate, soon)))
      .orderBy(asc(engagements.dueDate), asc(clients.displayName))
      .limit(8),
    db
      .select({
        id: tasks.id,
        title: tasks.title,
        dueDate: tasks.dueDate,
        engagementId: engagements.id,
        engagementTitle: engagements.title,
        clientName: clients.displayName,
      })
      .from(tasks)
      .innerJoin(engagements, eq(engagements.id, tasks.engagementId))
      .innerJoin(clients, eq(clients.id, engagements.clientId))
      .where(and(taskFirm, visible, eq(tasks.assigneeId, actor.userId), inArray(tasks.status, TASK_OPEN)))
      .orderBy(sql`${tasks.dueDate} asc nulls last`, asc(tasks.createdAt))
      .limit(8),
    db
      .select({ id: clients.id, displayName: clients.displayName, type: clients.type, createdAt: clients.createdAt })
      .from(clients)
      .where(visible)
      .orderBy(desc(clients.createdAt))
      .limit(5),
  ]);

  const order = engagements.status.enumValues.filter((s) => !DONE.includes(s));
  const byStatus = new Map(breakdown.map((r) => [r.status, r.count]));

  return {
    today,
    scope: opts.mine ? "mine" : "all",
    metrics: {
      open: openRow[0]?.n ?? 0,
      overdue: overdueRow[0]?.n ?? 0,
      dueSoon: soonRow[0]?.n ?? 0,
      waitingOnClient: waitingRow[0]?.n ?? 0,
      myOpenTasks: myTasksRow[0]?.n ?? 0,
      activeClients: clientsRow[0]?.n ?? 0,
    },
    statusBreakdown: order.map((status) => ({ status, count: byStatus.get(status) ?? 0 })),
    deadlines,
    myTasks,
    recentClients,
  };
}

/* ───────── Workspace overview (dashboard widgets) ───────── */

export interface WorkspaceOverview {
  today: string;
  scope: "mine" | "all";
  kpis: {
    totalClients: number;
    activeClients: number;
    newLeads: number;
    activeEngagements: number;
    tasksDueToday: number;
    overdueTasks: number;
    pendingClientDocuments: number;
    awaitingReview: number;
  };
  leadsByStage: { status: LeadStatus; count: number }[];
  /** converted / (converted + lost), as a 0–100 percentage; null when there are none yet. */
  conversionRate: number | null;
  recentLeads: { id: string; name: string; company: string | null; status: LeadStatus; createdAt: Date }[];
  followUps: { id: string; name: string; company: string | null; status: LeadStatus; followUpDate: string }[];
  followUpCount: number;
  engagementsByService: { serviceType: ServiceType; count: number }[];
  awaitingReviewList: { id: string; title: string; clientId: string; clientName: string; reason: "in_review" | "ready" }[];
  tasks: {
    myOpen: number;
    teamOpen: number;
    dueToday: number;
    overdue: number;
    completed7d: number;
    byStatus: { status: TaskStatus; count: number }[];
  };
  myTaskList: { id: string; title: string; dueDate: string | null; status: TaskStatus; clientName: string | null; engagementTitle: string | null }[];
}

/**
 * Tasks the actor may see: tasks of visible clients, plus internal tasks (no client) that are
 * theirs — all internal tasks for admins/managers/read-only. Mirrors services/tasks.ts.
 */
function visibleTasksCond(db: Db, actor: Actor): SQL {
  const visible = visibleClientsCondition(db, actor);
  return or(
    and(isNotNull(tasks.clientId), sql`exists (select 1 from ${clients} where ${clients.id} = ${tasks.clientId} and ${visible})`),
    and(isNull(tasks.clientId), seesAllClients(actor) ? undefined : or(eq(tasks.assigneeId, actor.userId), eq(tasks.assignedById, actor.userId))),
  )!;
}

const TASK_OPEN_SQL = sql.raw(`('todo','in_progress','waiting_client','waiting_review','blocked')`);

export async function getWorkspaceOverview(db: Db, actor: Actor, opts: { mine?: boolean; now?: Date } = {}): Promise<WorkspaceOverview> {
  requireStaff(actor);
  const now = opts.now ?? new Date();
  const today = firmToday(now);
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
  const mine = !!opts.mine;
  const n = sql<number>`count(*)::int`;

  const visible = visibleClientsCondition(db, actor);
  const clientScope = and(inFirm(clients.firmId, actor), visible, isNull(clients.archivedAt), mine ? eq(clients.accountManagerId, actor.userId) : undefined);
  const engScope = and(inFirm(engagements.firmId, actor), visible, mine ? eq(engagements.ownerId, actor.userId) : undefined);
  const taskScope = and(inFirm(tasks.firmId, actor), isNull(tasks.archivedAt), visibleTasksCond(db, actor), mine ? eq(tasks.assigneeId, actor.userId) : undefined);
  // Leads hold no taxpayer data: firm-wide for all staff (or the actor's own in "mine").
  const leadScope = and(inFirm(leads.firmId, actor), isNull(leads.archivedAt), mine ? eq(leads.ownerId, actor.userId) : undefined);
  const openTasks = inArray(tasks.status, [...TASK_OPEN]);
  const activeEng = inArray(engagements.status, [...ENGAGEMENT_OPEN]);

  // "Ready for review": open work, at least one counted task, none still open.
  const readyCond = sql`${engagements.status} not in ('in_review','filed','completed','cancelled','closed','draft','proposal_sent','awaiting_acceptance')
    and exists (select 1 from ${tasks} t where t.engagement_id = ${engagements.id} and t.firm_id = ${engagements.firmId} and t.archived_at is null and t.status <> 'cancelled')
    and not exists (select 1 from ${tasks} t where t.engagement_id = ${engagements.id} and t.firm_id = ${engagements.firmId} and t.archived_at is null and t.status in ${TASK_OPEN_SQL})`;

  const engJoin = () => db.select({ n }).from(engagements).innerJoin(clients, eq(clients.id, engagements.clientId));

  const [
    totalClients,
    activeClients,
    newLeads,
    activeEngagements,
    dueToday,
    overdue,
    pendingDocs,
    pendingRequests,
    inReview,
    ready,
    leadStages,
    recentLeads,
    followUps,
    followUpCount,
    byService,
    reviewList,
    myOpen,
    teamOpen,
    completed7d,
    taskStatuses,
    myTaskList,
  ] = await Promise.all([
    db.select({ n }).from(clients).where(clientScope),
    db.select({ n }).from(clients).where(and(clientScope, eq(clients.status, "active"))),
    db.select({ n }).from(leads).where(and(leadScope, eq(leads.status, "new"))),
    engJoin().where(and(engScope, activeEng)),
    db.select({ n }).from(tasks).where(and(taskScope, openTasks, eq(tasks.dueDate, today))),
    db.select({ n }).from(tasks).where(and(taskScope, openTasks, lt(tasks.dueDate, today))),
    db
      .select({ n })
      .from(onboardingItems)
      .innerJoin(clients, eq(clients.id, onboardingItems.clientId))
      .where(and(inFirm(onboardingItems.firmId, actor), clientScope, eq(onboardingItems.kind, "document"), eq(onboardingItems.status, "requested"))),
    db.select({ n }).from(tasks).where(and(taskScope, openTasks, eq(tasks.isClientTask, true))),
    engJoin().where(and(engScope, eq(engagements.status, "in_review"))),
    engJoin().where(and(engScope, readyCond)),
    db.select({ status: leads.status, count: n }).from(leads).where(leadScope).groupBy(leads.status),
    db.select({ id: leads.id, name: leads.name, company: leads.company, status: leads.status, createdAt: leads.createdAt }).from(leads).where(leadScope).orderBy(desc(leads.createdAt)).limit(5),
    db
      .select({ id: leads.id, name: leads.name, company: leads.company, status: leads.status, followUpDate: sql<string>`${leads.followUpDate}` })
      .from(leads)
      .where(and(leadScope, inArray(leads.status, [...LEAD_OPEN]), lte(leads.followUpDate, today)))
      .orderBy(asc(leads.followUpDate))
      .limit(6),
    db.select({ n }).from(leads).where(and(leadScope, inArray(leads.status, [...LEAD_OPEN]), lte(leads.followUpDate, today))),
    db
      .select({ serviceType: engagements.serviceType, count: n })
      .from(engagements)
      .innerJoin(clients, eq(clients.id, engagements.clientId))
      .where(and(engScope, notInArray(engagements.status, [...ENGAGEMENT_DONE])))
      .groupBy(engagements.serviceType),
    db
      .select({ id: engagements.id, title: engagements.title, clientId: clients.id, clientName: clients.displayName, status: engagements.status })
      .from(engagements)
      .innerJoin(clients, eq(clients.id, engagements.clientId))
      .where(and(engScope, or(eq(engagements.status, "in_review"), readyCond)))
      .orderBy(sql`${engagements.dueDate} asc nulls last`)
      .limit(6),
    db.select({ n }).from(tasks).where(and(taskScope, openTasks, eq(tasks.assigneeId, actor.userId))),
    db.select({ n }).from(tasks).where(and(taskScope, openTasks)),
    db.select({ n }).from(tasks).where(and(taskScope, eq(tasks.status, "completed"), gte(tasks.completedAt, weekAgo))),
    db
      .select({ status: tasks.status, count: n })
      .from(tasks)
      .where(and(taskScope, or(openTasks, and(eq(tasks.status, "completed"), gte(tasks.completedAt, weekAgo)))))
      .groupBy(tasks.status),
    db
      .select({ id: tasks.id, title: tasks.title, dueDate: tasks.dueDate, status: tasks.status, clientName: clients.displayName, engagementTitle: engagements.title })
      .from(tasks)
      .leftJoin(clients, and(eq(clients.id, tasks.clientId), eq(clients.firmId, tasks.firmId)))
      .leftJoin(engagements, and(eq(engagements.id, tasks.engagementId), eq(engagements.firmId, tasks.firmId)))
      .where(and(taskScope, openTasks, eq(tasks.assigneeId, actor.userId)))
      .orderBy(sql`${tasks.dueDate} asc nulls last`, asc(tasks.createdAt))
      .limit(8),
  ]);

  const stageMap = new Map(leadStages.map((r) => [r.status, r.count]));
  const converted = stageMap.get("converted") ?? 0;
  const lost = stageMap.get("lost") ?? 0;
  const statusMap = new Map(taskStatuses.map((r) => [r.status, r.count]));
  const first = (rows: { n: number }[]) => rows[0]?.n ?? 0;

  return {
    today,
    scope: mine ? "mine" : "all",
    kpis: {
      totalClients: first(totalClients),
      activeClients: first(activeClients),
      newLeads: first(newLeads),
      activeEngagements: first(activeEngagements),
      tasksDueToday: first(dueToday),
      overdueTasks: first(overdue),
      pendingClientDocuments: first(pendingDocs) + first(pendingRequests),
      awaitingReview: first(inReview) + first(ready),
    },
    leadsByStage: leads.status.enumValues.map((status) => ({ status, count: stageMap.get(status) ?? 0 })),
    conversionRate: converted + lost > 0 ? Math.round((converted / (converted + lost)) * 100) : null,
    recentLeads,
    followUps,
    followUpCount: first(followUpCount),
    engagementsByService: byService.sort((a, b) => b.count - a.count),
    awaitingReviewList: reviewList.map((r) => ({ id: r.id, title: r.title, clientId: r.clientId, clientName: r.clientName, reason: r.status === "in_review" ? ("in_review" as const) : ("ready" as const) })),
    tasks: {
      myOpen: first(myOpen),
      teamOpen: first(teamOpen),
      dueToday: first(dueToday),
      overdue: first(overdue),
      completed7d: first(completed7d),
      byStatus: (["todo", "in_progress", "waiting_client", "waiting_review", "blocked", "completed"] as TaskStatus[]).map((status) => ({ status, count: statusMap.get(status) ?? 0 })),
    },
    myTaskList,
  };
}
