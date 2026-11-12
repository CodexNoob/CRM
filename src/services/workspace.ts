import { and, desc, eq, ilike, isNotNull, isNull, lt, notInArray, or, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { clients, documents, engagements, leads, tasks } from "@/db/schema";
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
      .where(and(inFirm(engagements.firmId, actor), visible, isNotNull(engagements.dueDate), lt(engagements.dueDate, today), notInArray(engagements.status, ["filed", "completed"]))),
    db
      .select({ n })
      .from(tasks)
      .innerJoin(engagements, eq(engagements.id, tasks.engagementId))
      .innerJoin(clients, eq(clients.id, engagements.clientId))
      .where(
        and(
          inFirm(tasks.firmId, actor),
          inFirm(engagements.firmId, actor),
          visible,
          eq(tasks.assigneeId, actor.userId),
          eq(tasks.status, "open"),
          isNotNull(tasks.dueDate),
          sql`${tasks.dueDate} <= ${today}`,
        ),
      ),
  ]);
  const items: NotificationItem[] = [
    { id: "overdue", label: "Overdue engagements", detail: "Past their due date", count: overdue[0]?.n ?? 0, href: "/staff/engagements", tone: "danger" },
    { id: "tasks", label: "Your tasks due", detail: "Due today or overdue", count: myOverdueTasks[0]?.n ?? 0, href: "/staff/tasks", tone: "warn" },
    { id: "messages", label: "Unread client messages", detail: "Waiting for a reply", count: unread, href: "/staff/messages", tone: "info" },
    { id: "leads", label: "New leads", detail: "Not yet contacted", count: leadCounts.new, href: "/staff/leads?status=new", tone: "info" },
  ];
  return items.filter((i) => i.count > 0);
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
