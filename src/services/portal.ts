import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { clients, engagements, tasks, users, type EngagementStatus, type ServiceType } from "@/db/schema";
import type { Actor } from "@/lib/auth/actor";
import { ForbiddenError } from "@/lib/errors";

/**
 * The client's view of their own work. Only fields that are safe and useful
 * for the client are selected; internal tasks, assignment and audit data are
 * never loaded.
 */
export interface PortalOverview {
  clientName: string;
  engagements: {
    id: string;
    title: string;
    serviceType: ServiceType;
    taxYear: number | null;
    status: EngagementStatus;
    dueDate: string | null;
    contactName: string;
    tasks: { id: string; title: string; status: "open" | "done"; dueDate: string | null }[];
  }[];
}

function requireClientActor(actor: Actor): string {
  if (actor.role !== "client" || !actor.clientId) throw new ForbiddenError();
  return actor.clientId;
}

export async function getPortalOverview(db: Db, actor: Actor): Promise<PortalOverview> {
  const clientId = requireClientActor(actor);

  const [client] = await db.select({ name: clients.displayName }).from(clients).where(eq(clients.id, clientId));

  const rows = await db
    .select({
      id: engagements.id,
      title: engagements.title,
      serviceType: engagements.serviceType,
      taxYear: engagements.taxYear,
      status: engagements.status,
      dueDate: engagements.dueDate,
      contactName: users.name,
    })
    .from(engagements)
    .innerJoin(users, eq(users.id, engagements.ownerId))
    .where(eq(engagements.clientId, clientId))
    .orderBy(desc(engagements.createdAt));

  const ids = rows.map((r) => r.id);
  const clientTasks = ids.length
    ? await db
        .select({
          id: tasks.id,
          engagementId: tasks.engagementId,
          title: tasks.title,
          status: tasks.status,
          dueDate: tasks.dueDate,
        })
        .from(tasks)
        .where(and(inArray(tasks.engagementId, ids), eq(tasks.isClientTask, true)))
        .orderBy(asc(tasks.status), sql`${tasks.dueDate} asc nulls last`, asc(tasks.createdAt))
    : [];

  return {
    clientName: client?.name ?? "",
    engagements: rows.map((e) => ({
      ...e,
      tasks: clientTasks
        .filter((t) => t.engagementId === e.id)
        .map(({ id, title, status, dueDate }) => ({ id, title, status, dueDate })),
    })),
  };
}
