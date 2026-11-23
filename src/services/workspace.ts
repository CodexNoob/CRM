import { TASK_OPEN, ENGAGEMENT_DONE } from "@/lib/status";
import { and, desc, eq, gte, ilike, isNotNull, isNull, lt, ne, notInArray, or, sql, inArray } from "drizzle-orm";
import type { Db } from "@/db";
import { activities, clients, documents, engagements, leads, tasks, users } from "@/db/schema";
import type { Actor } from "@/lib/auth/actor";
import { inFirm, requireStaff, visibleClientsCondition } from "./access";
import { firmToday } from "./dashboard";
import { countLeadsByStatus } from "./leads";
import { countUnreadForStaff } from "./messages";

/* ───────── Notifications (derived from live data; nothing is stored) ───────── */

export interface NotificationItem {
  id: string;
  label: string;
  detail: string;
  count: number;
  href: string;
  tone: "danger" | "warn" | "info";
}

export async function getNotifications(db: Db, actor: Actor): Promise<NotificationItem[]> {
  requireStaff(actor);
  const visible = visibleClientsCondition(db, actor);
  const today = firmToday();
  const n = sql<number>`count(*)::int`;
  const [unread, leadCounts, overdue, myOverdueTasks] = await Promise.all([
    countUnreadForStaff(db, actor),
    countLeadsByStatus(db, actor),
    db
      .select({ n })
      .from(engagements)
      .innerJoin(clients, eq(clients.id, engagements.clientId))
      .where(and(inFirm(engagements.firmId, actor), visible, isNotNull(engagements.dueDate), lt(engagements.dueDate, today), notInArray(engagements.status, [...ENGAGEMENT_DONE]))),
    db
      .select({ n })
      .from(tasks)
      .leftJoin(engagements, and(eq(engagements.id, tasks.engagementId), eq(engagements.firmId, tasks.firmId)))
      .leftJoin(clients, and(sql`${clients.id} = coalesce(${tasks.clientId}, ${engagements.clientId})`, eq(clients.firmId, tasks.firmId)))
      .where(
        and(
          inFirm(tasks.firmId, actor),
          eq(tasks.assigneeId, actor.userId),
          inArray(tasks.status, TASK_OPEN),
          isNotNull(tasks.dueDate),
          sql`${tasks.dueDate} <= ${today}`,
          or(
            and(isNotNull(tasks.leadId), isNull(tasks.clientId)),
            and(isNotNull(engagements.id), inFirm(engagements.firmId, actor), visible),
            and(isNotNull(tasks.clientId), visible),
          ),
        ),
      ),
  ]);
  const items: NotificationItem[] = [
    { id: "overdue", label: "Overdue engagements", detail: "Past their due date", count: overdue[0]?.n ?? 0, href: "/crm/engagements?due=overdue", tone: "danger" },
    { id: "tasks", label: "Your tasks due", detail: "Due today or overdue", count: myOverdueTasks[0]?.n ?? 0, href: "/crm/tasks", tone: "warn" },
    { id: "messages", label: "Unread client messages", detail: "Waiting for a reply", count: unread, href: "/crm/messages", tone: "info" },
    { id: "leads", label: "New leads", detail: "Not yet contacted", count: leadCounts.new, href: "/crm/leads?status=new", tone: "info" },
  ];
  return [...items.filter((i) => i.count > 0), ...(await personalNotifications(db, actor))];
}

/**
 * Things that happened TO the actor in the last 14 days, from the activity timeline:
 * someone assigned them a task or engagement, or an engagement they manage became ready for review.
 * Only records the actor can still open are listed.
 */
async function personalNotifications(db: Db, actor: Actor): Promise<NotificationItem[]> {
  const since = new Date(Date.now() - 14 * 86_400_000);
  const visible = visibleClientsCondition(db, actor);
  const rows = await db
    .select({ id: activities.id, entityType: activities.entityType, entityId: activities.entityId, type: activities.type, metadata: activities.metadata, actorName: users.name })
    .from(activities)
    .leftJoin(users, eq(users.id, activities.actorId))
    .where(
      and(
        inFirm(activities.firmId, actor),
        gte(activities.occurredAt, since),
        or(isNull(activities.clientId), sql`exists (select 1 from ${clients} where ${clients.id} = ${activities.clientId} and ${visible})`),
        or(
          and(eq(activities.type, "assignment"), sql`${activities.metadata} ->> 'userId' = ${actor.userId}`, or(isNull(activities.actorId), ne(activities.actorId, actor.userId))),
          and(sql`${activities.metadata} ->> 'kind' = 'ready_for_review'`, sql`${activities.metadata} ->> 'notifyUserId' = ${actor.userId}`),
          // A client wrote (assignee or account manager is notified) / asked to change contact details.
          and(sql`${activities.metadata} ->> 'kind' in ('message', 'profile_change_request')`, sql`${activities.metadata} ->> 'notifyUserId' = ${actor.userId}`),
        ),
      ),
    )
    .orderBy(desc(activities.occurredAt))
    .limit(8);
  return rows.map((r) => {
    const title = typeof r.metadata?.title === "string" ? r.metadata.title : r.entityType === "task" ? "a task" : r.entityType === "lead" ? "a lead" : "an engagement";
    const href = r.entityType === "task" ? `/crm/tasks/${r.entityId}` : r.entityType === "lead" ? `/crm/leads/${r.entityId}` : `/crm/engagements/${r.entityId}`;
    const kind = typeof r.metadata?.kind === "string" ? r.metadata.kind : null;
    if (kind === "message") {
      const conv = typeof r.metadata?.conversationId === "string" ? r.metadata.conversationId : r.entityType === "conversation" ? r.entityId : null;
      return { id: `msg-${r.id}`, label: "New message from a client", detail: typeof r.metadata?.subject === "string" ? r.metadata.subject : (r.actorName ?? "Client"), count: 1, href: conv ? `/crm/messages/${conv}` : "/crm/messages", tone: "info" as const };
    }
    if (kind === "profile_change_request") {
      return { id: `profile-${r.id}`, label: "Client asked to update contact details", detail: "Review and update the client record", count: 1, href: r.entityType === "client" ? `/crm/clients/${r.entityId}?tab=activity` : "/crm/clients", tone: "warn" as const };
    }
    if (r.type === "assignment") {
      return { id: `assign-${r.id}`, label: `You were assigned to ${title}`, detail: r.actorName ? `By ${r.actorName}` : r.entityType === "task" ? "Follow-up task" : r.entityType === "lead" ? "Lead owner" : "Engagement team", count: 1, href, tone: "info" as const };
    }
    return { id: `review-${r.id}`, label: `${title} is ready for review`, detail: "All tasks are completed", count: 1, href, tone: "warn" as const };
  });
}

/* ───────── Global search ───────── */

export interface SearchResults {
  clients: { id: string; name: string; sub: string }[];
  engagements: { id: string; title: string; clientName: string }[];
  leads: { id: string; name: string; sub: string }[];
  documents: { id: string; fileName: string; clientName: string }[];
}

export async function globalSearch(db: Db, actor: Actor, raw: string): Promise<SearchResults> {
  requireStaff(actor);
  const q = raw.trim().slice(0, 100);
  if (q.length < 2) return { clients: [], engagements: [], leads: [], documents: [] };
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const visible = visibleClientsCondition(db, actor);
  const [c, e, l, d] = await Promise.all([
    db
      .select({ id: clients.id, name: clients.displayName, email: clients.email, phone: clients.phone })
      .from(clients)
      .where(and(visible, or(ilike(clients.displayName, like), ilike(clients.email, like), ilike(clients.phone, like))))
      .limit(8),
    db
      .select({ id: engagements.id, title: engagements.title, clientName: clients.displayName })
      .from(engagements)
      .innerJoin(clients, eq(clients.id, engagements.clientId))
      .where(and(inFirm(engagements.firmId, actor), visible, or(ilike(engagements.title, like), ilike(clients.displayName, like))))
      .orderBy(desc(engagements.updatedAt))
      .limit(8),
    db
      .select({ id: leads.id, name: leads.name, email: leads.email, company: leads.company })
      .from(leads)
      .where(and(inFirm(leads.firmId, actor), or(ilike(leads.name, like), ilike(leads.email, like), ilike(leads.company, like))))
      .limit(8),
    db
      .select({ id: documents.id, fileName: documents.fileName, clientName: clients.displayName })
      .from(documents)
      .innerJoin(clients, eq(clients.id, documents.clientId))
      .where(and(inFirm(documents.firmId, actor), visible, isNull(documents.deletedAt), ilike(documents.fileName, like)))
      .orderBy(desc(documents.createdAt))
      .limit(8),
  ]);
  return {
    clients: c.map((r) => ({ id: r.id, name: r.name, sub: [r.email, r.phone].filter(Boolean).join(" · ") })),
    engagements: e,
    leads: l.map((r) => ({ id: r.id, name: r.name, sub: [r.company, r.email].filter(Boolean).join(" · ") })),
    documents: d,
  };
}
