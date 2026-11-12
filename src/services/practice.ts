import { and, asc, desc, eq, gte, inArray, max, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "@/db";
import { auditEvents, clients, documents, engagements, leads, messages, users, type EngagementStatus, type ServiceType } from "@/db/schema";
import type { Actor } from "@/lib/auth/actor";
import { requireStaff, visibleClientsCondition } from "./access";

/** Views over engagement data for the Tax & Accounting modules. */

export const TAX_SERVICES: ServiceType[] = ["individual_tax", "business_tax"];
export const BOOKKEEPING_SERVICES: ServiceType[] = ["bookkeeping", "accounting"];

export interface WorkItem {
  id: string;
  title: string;
  serviceType: ServiceType;
  taxYear: number | null;
  status: EngagementStatus;
  dueDate: string | null;
  clientId: string;
  clientName: string;
  ownerName: string;
  openTasks: number;
  updatedAt: Date;
}

export async function listWork(db: Db, actor: Actor, opts: { services: ServiceType[]; taxYear?: number; status?: EngagementStatus }): Promise<WorkItem[]> {
  const visible = visibleClientsCondition(db, actor);
  const owner = alias(users, "work_owner");
  return db
    .select({
      id: engagements.id,
      title: engagements.title,
      serviceType: engagements.serviceType,
      taxYear: engagements.taxYear,
      status: engagements.status,
      dueDate: engagements.dueDate,
      clientId: clients.id,
      clientName: clients.displayName,
      ownerName: owner.name,
      openTasks: sql<number>`(select count(*)::int from tasks t where t.engagement_id = ${engagements.id} and t.status = 'open')`,
      updatedAt: engagements.updatedAt,
    })
    .from(engagements)
    .innerJoin(clients, eq(clients.id, engagements.clientId))
    .innerJoin(owner, eq(owner.id, engagements.ownerId))
    .where(
      and(
        visible,
        inArray(engagements.serviceType, opts.services),
        opts.taxYear ? eq(engagements.taxYear, opts.taxYear) : undefined,
        opts.status ? eq(engagements.status, opts.status) : undefined,
      ),
    )
    .orderBy(sql`${engagements.dueDate} asc nulls last`, asc(clients.displayName))
    .limit(500);
}

export async function listTaxYears(db: Db, actor: Actor): Promise<number[]> {
  const visible = visibleClientsCondition(db, actor);
  const rows = await db
    .selectDistinct({ y: engagements.taxYear })
    .from(engagements)
    .innerJoin(clients, eq(clients.id, engagements.clientId))
    .where(and(visible, inArray(engagements.serviceType, TAX_SERVICES)))
    .orderBy(desc(engagements.taxYear));
  return rows.map((r) => r.y).filter((y): y is number => y !== null);
}

/* ───────── Client portal management ───────── */

export interface PortalAccount {
  userId: string;
  name: string;
  email: string;
  isActive: boolean;
  hasPassword: boolean;
  clientId: string;
  clientName: string;
  lastSignIn: Date | null;
  unreadFromClient: number;
  sharedDocuments: number;
}

export async function listPortalAccounts(db: Db, actor: Actor): Promise<PortalAccount[]> {
  const visible = visibleClientsCondition(db, actor);
  const lastLogin = db
    .select({ userId: auditEvents.actorUserId, at: max(auditEvents.createdAt).as("at") })
    .from(auditEvents)
    .where(eq(auditEvents.action, "auth.login"))
    .groupBy(auditEvents.actorUserId)
    .as("last_login");
  return db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      isActive: users.isActive,
      hasPassword: sql<boolean>`${users.passwordHash} is not null`,
      clientId: clients.id,
      clientName: clients.displayName,
      lastSignIn: lastLogin.at,
      unreadFromClient: sql<number>`(select count(*)::int from ${messages} m where m.client_id = ${clients.id} and m.from_client and m.read_at is null)`,
      sharedDocuments: sql<number>`(select count(*)::int from ${documents} d where d.client_id = ${clients.id} and d.visible_to_client and d.deleted_at is null)`,
    })
    .from(users)
    .innerJoin(clients, eq(clients.id, users.clientId))
    .leftJoin(lastLogin, eq(lastLogin.userId, users.id))
    .where(and(eq(users.role, "client"), visible))
    .orderBy(asc(clients.displayName), asc(users.name));
}

/* ───────── Practice reports (from CRM data; revenue needs QuickBooks) ───────── */

export interface PracticeReport {
  byService: { serviceType: ServiceType; open: number; done: number }[];
  byStatus: { status: EngagementStatus; count: number }[];
  leads: { status: string; count: number }[];
  leadSources: { source: string; count: number }[];
  last30: { newClients: number; documentsUploaded: number; messages: number; engagementsCompleted: number };
}

export async function getPracticeReport(db: Db, actor: Actor, now = new Date()): Promise<PracticeReport> {
  requireStaff(actor);
  const visible = visibleClientsCondition(db, actor);
  const since = new Date(now.getTime() - 30 * 86_400_000);
  const n = sql<number>`count(*)::int`;
  const done = sql<boolean>`${engagements.status} in ('filed', 'completed')`;

  const [byServiceRows, byStatus, leadRows, sourceRows, newClients, docs, msgs, completed] = await Promise.all([
    db
      .select({ serviceType: engagements.serviceType, done, count: n })
      .from(engagements)
      .innerJoin(clients, eq(clients.id, engagements.clientId))
      .where(visible)
      .groupBy(engagements.serviceType, done),
    db
      .select({ status: engagements.status, count: n })
      .from(engagements)
      .innerJoin(clients, eq(clients.id, engagements.clientId))
      .where(visible)
      .groupBy(engagements.status),
    db.select({ status: leads.status, count: n }).from(leads).groupBy(leads.status),
    db.select({ source: leads.source, count: n }).from(leads).groupBy(leads.source),
    db.select({ count: n }).from(clients).where(and(visible, gte(clients.createdAt, since))),
    db.select({ count: n }).from(documents).innerJoin(clients, eq(clients.id, documents.clientId)).where(and(visible, gte(documents.createdAt, since))),
    db.select({ count: n }).from(messages).innerJoin(clients, eq(clients.id, messages.clientId)).where(and(visible, gte(messages.createdAt, since))),
    db
      .select({ count: n })
      .from(engagements)
      .innerJoin(clients, eq(clients.id, engagements.clientId))
      .where(and(visible, done, gte(engagements.updatedAt, since))),
  ]);

  const services = new Map<ServiceType, { open: number; done: number }>();
  for (const r of byServiceRows) {
    const cur = services.get(r.serviceType) ?? { open: 0, done: 0 };
    if (r.done) cur.done += r.count;
    else cur.open += r.count;
    services.set(r.serviceType, cur);
  }
  return {
    byService: [...services.entries()].map(([serviceType, v]) => ({ serviceType, ...v })).sort((a, b) => b.open + b.done - (a.open + a.done)),
    byStatus,
    leads: leadRows,
    leadSources: sourceRows,
    last30: {
      newClients: newClients[0]?.count ?? 0,
      documentsUploaded: docs[0]?.count ?? 0,
      messages: msgs[0]?.count ?? 0,
      engagementsCompleted: completed[0]?.count ?? 0,
    },
  };
}
