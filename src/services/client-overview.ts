import { and, asc, eq, gte, inArray, isNotNull, isNull, lt, lte, notInArray, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "@/db";
import { clients, engagements, onboardingItems, tasks, users, type ClientStatus, type ClientType, type OnboardingStatus } from "@/db/schema";
import type { Actor } from "@/lib/auth/actor";
import { isUuid } from "@/lib/validation";
import { ENGAGEMENT_DONE, TASK_OPEN } from "@/lib/status";
import { assertClientAccess, inFirm, visibleClientsCondition } from "./access";

/**
 * Read-only queries for the Clients screens (list rows and the client overview).
 * Every query is limited to the actor's firm and to the clients the actor may see.
 */

export interface ClientListFilters {
  type?: ClientType;
  status?: ClientStatus;
  /** A staff user id, or "none" for clients without an account manager. */
  manager?: string;
  onboarding?: OnboardingStatus;
  archived?: boolean;
}

export interface ClientListRow {
  id: string;
  clientNumber: number | null;
  displayName: string;
  type: ClientType;
  status: ClientStatus;
  onboardingStatus: OnboardingStatus;
  email: string | null;
  phone: string | null;
  accountManagerId: string | null;
  accountManagerName: string | null;
  openEngagements: number;
  pendingTasks: number;
  portalUsers: number;
  archivedAt: Date | null;
  createdAt: Date;
}

const manager = alias(users, "account_manager");

const doneEngagementStatuses = sql.raw(`(${ENGAGEMENT_DONE.map((s) => `'${s}'`).join(",")})`);
const openTaskStatuses = sql.raw(`(${TASK_OPEN.map((s) => `'${s}'`).join(",")})`);

export async function listClientRows(db: Db, actor: Actor, f: ClientListFilters = {}): Promise<ClientListRow[]> {
  const visible = visibleClientsCondition(db, actor);
  const conds: (SQL | undefined)[] = [
    inFirm(clients.firmId, actor),
    visible,
    f.archived ? isNotNull(clients.archivedAt) : isNull(clients.archivedAt),
    f.type ? eq(clients.type, f.type) : undefined,
    f.status ? eq(clients.status, f.status) : undefined,
    f.onboarding ? eq(clients.onboardingStatus, f.onboarding) : undefined,
    f.manager === "none" ? isNull(clients.accountManagerId) : f.manager && isUuid(f.manager) ? eq(clients.accountManagerId, f.manager) : undefined,
  ];
  return db
    .select({
      id: clients.id,
      clientNumber: clients.clientNumber,
      displayName: clients.displayName,
      type: clients.type,
      status: clients.status,
      onboardingStatus: clients.onboardingStatus,
      email: clients.email,
      phone: clients.phone,
      accountManagerId: clients.accountManagerId,
      accountManagerName: manager.name,
      openEngagements: sql<number>`(select count(*)::int from engagements e where e.client_id = ${clients.id} and e.firm_id = ${clients.firmId} and e.status not in ${doneEngagementStatuses})`,
      pendingTasks: sql<number>`(select count(*)::int from tasks t where t.client_id = ${clients.id} and t.firm_id = ${clients.firmId} and t.archived_at is null and t.status in ${openTaskStatuses})`,
      portalUsers: sql<number>`(select count(*)::int from users pu where pu.client_id = ${clients.id} and pu.firm_id = ${clients.firmId} and pu.role = 'client' and pu.is_active)`,
      archivedAt: clients.archivedAt,
      createdAt: clients.createdAt,
    })
    .from(clients)
    .leftJoin(manager, and(eq(manager.id, clients.accountManagerId), eq(manager.firmId, clients.firmId)))
    .where(and(...conds))
    .orderBy(asc(clients.displayName))
    .limit(2000);
}

export interface UpcomingItem {
  kind: "engagement" | "task";
  id: string;
  title: string;
  dueDate: string;
  href: string;
}

export interface ClientSummary {
  accountManagerName: string | null;
  activeEngagements: number;
  pendingTasks: number;
  overdueTasks: number;
  upcoming: UpcomingItem[];
  onboarding: { total: number; done: number };
}

/** Overview figures for one client. `today` is the firm's date (YYYY-MM-DD). */
export async function getClientSummary(db: Db, actor: Actor, clientId: string, today: string): Promise<ClientSummary> {
  await assertClientAccess(db, actor, clientId);
  const horizon = new Date(`${today}T00:00:00Z`);
  horizon.setUTCDate(horizon.getUTCDate() + 30);
  const until = horizon.toISOString().slice(0, 10);

  const engagementScope = and(inFirm(engagements.firmId, actor), eq(engagements.clientId, clientId), notInArray(engagements.status, [...ENGAGEMENT_DONE]));
  const taskScope = and(inFirm(tasks.firmId, actor), eq(tasks.clientId, clientId), isNull(tasks.archivedAt), inArray(tasks.status, [...TASK_OPEN]));

  const [[mgr], [eng], [tsk], dueEngagements, dueTasks, [ob]] = await Promise.all([
    db
      .select({ name: manager.name })
      .from(clients)
      .leftJoin(manager, and(eq(manager.id, clients.accountManagerId), eq(manager.firmId, clients.firmId)))
      .where(and(eq(clients.id, clientId), inFirm(clients.firmId, actor))),
    db.select({ n: sql<number>`count(*)::int` }).from(engagements).where(engagementScope),
    db
      .select({ pending: sql<number>`count(*)::int`, overdue: sql<number>`count(*) filter (where ${tasks.dueDate} < ${today})::int` })
      .from(tasks)
      .where(taskScope),
    db
      .select({ id: engagements.id, title: engagements.title, dueDate: engagements.dueDate })
      .from(engagements)
      .where(and(engagementScope, isNotNull(engagements.dueDate), gte(engagements.dueDate, today), lte(engagements.dueDate, until)))
      .orderBy(asc(engagements.dueDate))
      .limit(10),
    db
      .select({ id: tasks.id, title: tasks.title, dueDate: tasks.dueDate, engagementId: tasks.engagementId })
      .from(tasks)
      .where(and(taskScope, isNotNull(tasks.dueDate), gte(tasks.dueDate, today), lt(tasks.dueDate, until)))
      .orderBy(asc(tasks.dueDate))
      .limit(10),
    db
      .select({ total: sql<number>`count(*)::int`, done: sql<number>`count(*) filter (where ${onboardingItems.status} in ('verified','waived'))::int` })
      .from(onboardingItems)
      .where(and(inFirm(onboardingItems.firmId, actor), eq(onboardingItems.clientId, clientId))),
  ]);

  const upcoming: UpcomingItem[] = [
    ...dueEngagements.map((e) => ({ kind: "engagement" as const, id: e.id, title: e.title, dueDate: e.dueDate!, href: `/crm/engagements/${e.id}` })),
    ...dueTasks.map((t) => ({
      kind: "task" as const,
      id: t.id,
      title: t.title,
      dueDate: t.dueDate!,
      href: t.engagementId ? `/crm/engagements/${t.engagementId}` : `/crm/tasks`,
    })),
  ]
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, 10);

  return {
    accountManagerName: mgr?.name ?? null,
    activeEngagements: eng?.n ?? 0,
    pendingTasks: tsk?.pending ?? 0,
    overdueTasks: tsk?.overdue ?? 0,
    upcoming,
    onboarding: { total: ob?.total ?? 0, done: ob?.done ?? 0 },
  };
}
