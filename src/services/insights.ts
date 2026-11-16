import { ASSIGNABLE_ROLES } from "@/lib/auth/actor";
import { TASK_OPEN, ENGAGEMENT_DONE } from "@/lib/status";
import { and, asc, desc, eq, inArray, isNotNull, lt, notInArray, or, sql, type SQL } from "drizzle-orm";
import type { Db } from "@/db";
import { activities, auditEvents, clientAssignments, clients, documents, engagements, tasks, users, type EngagementStatus, type ClientStatus } from "@/db/schema";
import { alias } from "drizzle-orm/pg-core";
import { seesAllClients, type Actor } from "@/lib/auth/actor";
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
  "subscription.checkout": "started a recurring invoice schedule",
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
  const open = notInArray(engagements.status, [...ENGAGEMENT_DONE]);
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
      .where(and(visible, inFirm(tasks.firmId, actor), inArray(tasks.status, TASK_OPEN), isNotNull(tasks.assigneeId)))
      .groupBy(tasks.assigneeId),
    db.select({ id: users.id, name: users.name, role: users.role }).from(users).where(and(inFirm(users.firmId, actor), eq(users.isActive, true), inArray(users.role, ASSIGNABLE_ROLES))).orderBy(asc(users.name)),
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
      .where(and(visible, inFirm(engagements.firmId, actor), inArray(engagements.serviceType, ["individual_tax", "business_tax"]), notInArray(engagements.status, [...ENGAGEMENT_DONE]))),
    db
      .select({ n })
      .from(tasks)
      .innerJoin(engagements, eq(engagements.id, tasks.engagementId))
      .innerJoin(clients, eq(clients.id, engagements.clientId))
      .where(and(visible, inFirm(tasks.firmId, actor), eq(tasks.isClientTask, true), inArray(tasks.status, TASK_OPEN))),
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
    .where(and(visible, inFirm(tasks.firmId, actor), eq(tasks.assigneeId, actor.userId), inArray(tasks.status, TASK_OPEN), or(lt(tasks.dueDate, soon), sql`${tasks.dueDate} = ${soon}`)))
    .orderBy(asc(tasks.dueDate))
    .limit(limit);
}

/* ───────── Client list with summary columns ───────── */

export interface ClientOverviewRow {
  id: string;
  displayName: string;
  type: "individual" | "household" | "business";
  status: ClientStatus;
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
      openEngagements: sql<number>`(select count(*)::int from engagements e where e.client_id = "clients"."id" and e.firm_id = "clients"."firm_id" and e.status not in ('filed','completed','cancelled','closed'))`,
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

/* ───────── Workspace activity feed (business timeline, not the security log) ───────── */

export interface WorkspaceActivity {
  id: string;
  entityType: "lead" | "client" | "engagement" | "task";
  entityId: string;
  type: string;
  body: string | null;
  metadata: Record<string, unknown> | null;
  occurredAt: Date;
  actorName: string | null;
  /** Name/title of the record the event is about (lead name, client, engagement or task title). */
  entityName: string | null;
  /** For assignments: the person assigned. */
  assigneeName: string | null;
}

/**
 * Recent workflow events the actor may see: lead created/converted, client created, engagement
 * created / status changed / ready for review, task assigned / completed. Client-linked events are
 * limited to visible clients; lead events are firm-wide (leads hold no taxpayer data); events with
 * neither are shown only to their actor (or to staff who see all clients).
 */
export async function listWorkspaceActivity(db: Db, actor: Actor, limit = 15): Promise<WorkspaceActivity[]> {
  requireStaff(actor);
  const visible = visibleClientsCondition(db, actor);
  const assigneeUser = alias(users, "assignee_user");
  const rows = await db
    .select({
      id: activities.id,
      entityType: activities.entityType,
      entityId: activities.entityId,
      type: activities.type,
      body: activities.body,
      metadata: activities.metadata,
      occurredAt: activities.occurredAt,
      actorName: users.name,
      assigneeName: assigneeUser.name,
      entityName: sql<string | null>`case ${activities.entityType}
        when 'lead' then (select l.name from leads l where l.id = ${activities.entityId} and l.firm_id = ${activities.firmId})
        when 'client' then (select c.display_name from clients c where c.id = ${activities.entityId} and c.firm_id = ${activities.firmId})
        when 'engagement' then (select e.title from engagements e where e.id = ${activities.entityId} and e.firm_id = ${activities.firmId})
        when 'task' then (select t.title from tasks t where t.id = ${activities.entityId} and t.firm_id = ${activities.firmId})
      end`,
    })
    .from(activities)
    .leftJoin(users, eq(users.id, activities.actorId))
    .leftJoin(assigneeUser, sql`${activities.type} = 'assignment' and ${assigneeUser.id}::text = ${activities.metadata} ->> 'userId'`)
    .where(
      and(
        inFirm(activities.firmId, actor),
        or(
          sql`${activities.clientId} is not null and exists (select 1 from ${clients} where ${clients.id} = ${activities.clientId} and ${visible})`,
          and(sql`${activities.clientId} is null`, eq(activities.entityType, "lead")),
          and(sql`${activities.clientId} is null`, sql`${activities.entityType} <> 'lead'`, seesAllClients(actor) ? undefined : eq(activities.actorId, actor.userId)),
        ),
        sql`(
          (${activities.entityType} = 'lead' and ${activities.type} = 'system' and ${activities.body} in ('Lead created', 'Inquiry received from the website'))
          or (${activities.entityType} = 'lead' and ${activities.type} = 'status_change' and ${activities.metadata} ->> 'to' = 'converted')
          or (${activities.entityType} = 'client' and ${activities.type} = 'system' and ${activities.body} like 'Client created%')
          or (${activities.entityType} = 'engagement' and ${activities.type} = 'system' and (${activities.body} like 'Engagement created%' or ${activities.metadata} ->> 'kind' = 'ready_for_review'))
          or (${activities.entityType} = 'engagement' and ${activities.type} = 'status_change' and ${activities.metadata} ->> 'from' is not null)
          or (${activities.entityType} = 'task' and ${activities.type} = 'assignment')
          or (${activities.entityType} = 'task' and ${activities.type} = 'status_change' and ${activities.metadata} ->> 'to' = 'completed')
        )`,
      ),
    )
    .orderBy(desc(activities.occurredAt), desc(activities.createdAt))
    .limit(limit);
  return rows as WorkspaceActivity[];
}
