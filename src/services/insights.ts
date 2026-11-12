import { and, asc, desc, eq, inArray, isNotNull, lt, notInArray, or, sql, type SQL } from "drizzle-orm";
import type { Db } from "@/db";
import { auditEvents, clientAssignments, clients, documents, engagements, tasks, users, type EngagementStatus } from "@/db/schema";
import type { Actor } from "@/lib/auth/actor";
import { assertClientAccess, inFirm, requireStaff, visibleClientsCondition } from "./access";
import { firmToday } from "./dashboard";

/* ───────── Activity feed (from the audit trail, scoped to records the actor can see) ───────── */

export interface ActivityItem {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actorName: string | null;
  clientId: string | null;
  clientName: string | null;
  createdAt: Date;
}

/**
 * Resolves the client an audit event belongs to (client, engagement, document or task events).
 * Lookups are limited to the event's own firm; queries using this are also firm-filtered.
 */
const eventClientId = sql<string | null>`coalesce(
  case when ${auditEvents.entityType} = 'client' then ${auditEvents.entityId} end,
  (select e.client_id::text from engagements e where ${auditEvents.entityType} = 'engagement' and e.id::text = ${auditEvents.entityId} and e.firm_id = ${auditEvents.firmId}),
  (select d.client_id::text from documents d where ${auditEvents.entityType} = 'document' and d.id::text = ${auditEvents.entityId} and d.firm_id = ${auditEvents.firmId}),
  (select e.client_id::text from tasks t join engagements e on e.id = t.engagement_id where ${auditEvents.entityType} = 'task' and t.id::text = ${auditEvents.entityId} and t.firm_id = ${auditEvents.firmId}),
  ${auditEvents.metadata} ->> 'clientId'
)`;

async function activity(db: Db, actor: Actor, where: SQL | undefined, limit: number): Promise<ActivityItem[]> {
  const rows = await db
    .select({
      id: auditEvents.id,
      action: auditEvents.action,
      entityType: auditEvents.entityType,
      entityId: auditEvents.entityId,
      actorName: users.name,
      clientId: eventClientId,
      createdAt: auditEvents.createdAt,
    })
    .from(auditEvents)
    .leftJoin(users, eq(users.id, auditEvents.actorUserId))
    .where(and(inFirm(auditEvents.firmId, actor), sql`${auditEvents.action} not like 'auth.%'`, sql`${auditEvents.action} not like 'setup.%'`, where))
    .orderBy(desc(auditEvents.createdAt))
    .limit(limit * 3);
  // Attach client names and drop events whose client the caller cannot resolve.
  const ids = [...new Set(rows.map((r) => r.clientId).filter((x): x is string => !!x))];
  const names = ids.length ? await db.select({ id: clients.id, name: clients.displayName }).from(clients).where(and(inFirm(clients.firmId, actor), inArray(sql`${clients.id}::text`, ids))) : [];
  const nameOf = new Map(names.map((n) => [n.id, n.name]));
  return rows
    .filter((r) => r.clientId && nameOf.has(r.clientId))
    .slice(0, limit)
    .map((r) => ({ ...r, clientName: nameOf.get(r.clientId!) ?? null }));
}

/** Recent activity on one client. Requires access to the client. */
export async function listClientActivity(db: Db, actor: Actor, clientId: string, limit = 50): Promise<ActivityItem[]> {
  await assertClientAccess(db, actor, clientId);
  return activity(db, actor, sql`${eventClientId} = ${clientId}`, limit);
}

/** Recent activity across every client the staff member can see. */
export async function listRecentClientActivity(db: Db, actor: Actor, limit = 12): Promise<ActivityItem[]> {
  const visibleIds = db.select({ id: sql`${clients.id}::text` }).from(clients).where(visibleClientsCondition(db, actor));
  return activity(db, actor, sql`${eventClientId} in (${visibleIds})`, limit);
}

export const ACTIVITY_LABELS: Record<string, string> = {
  "client.create": "created the client",
  "client.update": "updated client details",
  "engagement.create": "opened an engagement",
  "engagement.update": "updated an engagement",
  "task.create": "added a task",
  "task.complete": "completed a task",
  "task.reopen": "reopened a task",
  "portal.invite": "issued a portal invitation",
  "document.upload": "uploaded a document",
  "document.download": "downloaded a document",
  "document.share": "shared a document",
  "document.unshare": "unshared a document",
  "document.archive": "archived a document",
  "message.send": "sent a message",
  "lead.convert": "converted a lead to this client",
  "appointment.create": "scheduled an appointment",
  "appointment.cancel": "cancelled an appointment",
  "invoice.create": "created an invoice",
  "invoice.send": "sent an invoice",
  "invoice.paid": "received payment for an invoice",
  "invoice.cancel": "cancelled an invoice",
  "subscription.create": "set up a subscription",
  "subscription.checkout": "started subscribing in PayPal",
  "subscription.activate": "subscription became active",
  "subscription.cancel": "cancelled a subscription",
};

/* ───────── Workload by staff member ───────── */

export interface WorkloadRow {
  userId: string;
  name: string;
  role: string;
  openEngagements: number;
  overdue: number;
  inReview: number;
  openTasks: number;
}

export async function getWorkload(db: Db, actor: Actor): Promise<WorkloadRow[]> {
  requireStaff(actor);
  const visible = visibleClientsCondition(db, actor);
  const today = firmToday();
  const open = notInArray(engagements.status, ["filed", "completed"]);
  const [eng, tsk, staff] = await Promise.all([
    db
      .select({
        ownerId: engagements.ownerId,
        open: sql<number>`count(*)::int`,
        overdue: sql<number>`count(*) filter (where ${engagements.dueDate} < ${today})::int`,
        inReview: sql<number>`count(*) filter (where ${engagements.status} = 'in_review')::int`,
      })
      .from(engagements)
      .innerJoin(clients, eq(clients.id, engagements.clientId))
      .where(and(visible, inFirm(engagements.firmId, actor), open))
      .groupBy(engagements.ownerId),
    db
      .select({ assigneeId: tasks.assigneeId, n: sql<number>`count(*)::int` })
      .from(tasks)
      .innerJoin(engagements, eq(engagements.id, tasks.engagementId))
      .innerJoin(clients, eq(clients.id, engagements.clientId))
      .where(and(visible, inFirm(tasks.firmId, actor), eq(tasks.status, "open"), isNotNull(tasks.assigneeId)))
      .groupBy(tasks.assigneeId),
    db.select({ id: users.id, name: users.name, role: users.role }).from(users).where(and(inFirm(users.firmId, actor), eq(users.isActive, true), inArray(users.role, ["admin", "partner", "preparer"]))).orderBy(asc(users.name)),
  ]);
  const e = new Map(eng.map((r) => [r.ownerId, r]));
  const t = new Map(tsk.map((r) => [r.assigneeId, r.n]));
  return staff
    .map((s) => ({
      userId: s.id,
      name: s.name,
      role: s.role,
      openEngagements: e.get(s.id)?.open ?? 0,
      overdue: e.get(s.id)?.overdue ?? 0,
      inReview: e.get(s.id)?.inReview ?? 0,
      openTasks: t.get(s.id) ?? 0,
    }))
    .sort((a, b) => b.openEngagements + b.openTasks - (a.openEngagements + a.openTasks));
}

/* ───────── Dashboard extras ───────── */

export async function getPracticeCounts(db: Db, actor: Actor) {
  const visible = visibleClientsCondition(db, actor);
  const n = sql<number>`count(*)::int`;
  const [pendingReturns, openRequests, docs7] = await Promise.all([
    db
      .select({ n })
      .from(engagements)
      .innerJoin(clients, eq(clients.id, engagements.clientId))
      .where(and(visible, inFirm(engagements.firmId, actor), inArray(engagements.serviceType, ["individual_tax", "business_tax"]), notInArray(engagements.status, ["filed", "completed"]))),
    db
      .select({ n })
      .from(tasks)
      .innerJoin(engagements, eq(engagements.id, tasks.engagementId))
      .innerJoin(clients, eq(clients.id, engagements.clientId))
      .where(and(visible, inFirm(tasks.firmId, actor), eq(tasks.isClientTask, true), eq(tasks.status, "open"))),
    db
      .select({ n })
      .from(documents)
      .innerJoin(clients, eq(clients.id, documents.clientId))
      .where(and(visible, inFirm(documents.firmId, actor), sql`${documents.createdAt} > now() - interval '7 days'`, sql`${documents.deletedAt} is null`)),
  ]);
  return { pendingReturns: pendingReturns[0]?.n ?? 0, openClientRequests: openRequests[0]?.n ?? 0, documentsThisWeek: docs7[0]?.n ?? 0 };
}

/** Tasks needing attention: the actor's open tasks that are overdue or due within 7 days, plus undated ones. */
export async function listAttentionTasks(db: Db, actor: Actor, limit = 8) {
  const visible = visibleClientsCondition(db, actor);
  const soon = new Date(Date.parse(`${firmToday()}T00:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);
  return db
    .select({ id: tasks.id, title: tasks.title, dueDate: tasks.dueDate, engagementId: engagements.id, engagementTitle: engagements.title, clientName: clients.displayName })
    .from(tasks)
    .innerJoin(engagements, eq(engagements.id, tasks.engagementId))
    .innerJoin(clients, eq(clients.id, engagements.clientId))
    .where(and(visible, inFirm(tasks.firmId, actor), eq(tasks.assigneeId, actor.userId), eq(tasks.status, "open"), or(lt(tasks.dueDate, soon), sql`${tasks.dueDate} = ${soon}`)))
    .orderBy(asc(tasks.dueDate))
    .limit(limit);
}

/* ───────── Client list with summary columns ───────── */

export interface ClientOverviewRow {
  id: string;
  displayName: string;
  type: "individual" | "household" | "business";
  status: "prospect" | "active" | "inactive";
  email: string | null;
  phone: string | null;
  createdAt: Date;
  openEngagements: number;
  team: string | null;
  portalUsers: number;
}

export async function listClientsOverview(db: Db, actor: Actor): Promise<ClientOverviewRow[]> {
  const visible = visibleClientsCondition(db, actor);
  return db
    .select({
      id: clients.id,
      displayName: clients.displayName,
      type: clients.type,
      status: clients.status,
      email: clients.email,
      phone: clients.phone,
      createdAt: clients.createdAt,
      openEngagements: sql<number>`(select count(*)::int from engagements e where e.client_id = "clients"."id" and e.firm_id = "clients"."firm_id" and e.status not in ('filed','completed'))`,
      team: sql<string | null>`(select string_agg(u.name, ', ' order by u.name) from client_assignments ca join users u on u.id = ca.user_id where ca.client_id = "clients"."id" and ca.firm_id = "clients"."firm_id" and u.firm_id = "clients"."firm_id" and u.is_active)`,
      portalUsers: sql<number>`(select count(*)::int from users pu where pu.client_id = "clients"."id" and pu.firm_id = "clients"."firm_id" and pu.role = 'client' and pu.is_active)`,
    })
    .from(clients)
    .where(visible)
    .orderBy(asc(clients.displayName))
    .limit(2000);
}

/* ───────── Client profile helpers ───────── */

export async function getClientTeam(db: Db, actor: Actor, clientId: string) {
  await assertClientAccess(db, actor, clientId);
  return db
    .select({ id: users.id, name: users.name, role: users.role })
    .from(clientAssignments)
    .innerJoin(users, eq(users.id, clientAssignments.userId))
    .where(and(inFirm(clientAssignments.firmId, actor), inFirm(users.firmId, actor), eq(clientAssignments.clientId, clientId), eq(users.isActive, true)))
    .orderBy(asc(users.name));
}

/** Most recent tax engagement for the client (drives "tax year" and "filing status" in the profile header). */
export async function getLatestTaxEngagement(db: Db, actor: Actor, clientId: string): Promise<{ taxYear: number | null; status: EngagementStatus; title: string } | null> {
  await assertClientAccess(db, actor, clientId);
  const [row] = await db
    .select({ taxYear: engagements.taxYear, status: engagements.status, title: engagements.title })
    .from(engagements)
    .where(and(inFirm(engagements.firmId, actor), eq(engagements.clientId, clientId), inArray(engagements.serviceType, ["individual_tax", "business_tax"])))
    .orderBy(sql`${engagements.taxYear} desc nulls last`, desc(engagements.createdAt))
    .limit(1);
  return row ?? null;
}
