import { TASK_OPEN, ENGAGEMENT_DONE } from "@/lib/status";
import { and, asc, desc, eq, gte, isNotNull, lt, lte, notInArray, sql, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "@/db";
import { clients, engagements, tasks, users, type EngagementStatus } from "@/db/schema";
import type { Actor } from "@/lib/auth/actor";
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
