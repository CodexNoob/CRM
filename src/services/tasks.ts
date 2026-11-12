import { and, asc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "@/db";
import { clients, engagements, tasks, users } from "@/db/schema";
import type { Actor } from "@/lib/auth/actor";
import { visibleClientsCondition } from "./access";

export interface TaskRow {
  id: string;
  title: string;
  status: "open" | "done";
  isClientTask: boolean;
  dueDate: string | null;
  assigneeName: string | null;
  engagementId: string;
  engagementTitle: string;
  clientId: string;
  clientName: string;
}

/** Tasks on engagements the actor can see. `mine` = assigned to the actor. */
export async function listTasks(
  db: Db,
  actor: Actor,
  opts: { mine?: boolean; status?: "open" | "done"; clientId?: string } = {},
): Promise<TaskRow[]> {
  const visible = visibleClientsCondition(db, actor);
  const assignee = alias(users, "assignee");
  return db
    .select({
      id: tasks.id,
      title: tasks.title,
      status: tasks.status,
      isClientTask: tasks.isClientTask,
      dueDate: tasks.dueDate,
      assigneeName: assignee.name,
      engagementId: engagements.id,
      engagementTitle: engagements.title,
      clientId: clients.id,
      clientName: clients.displayName,
    })
    .from(tasks)
    .innerJoin(engagements, eq(engagements.id, tasks.engagementId))
    .innerJoin(clients, eq(clients.id, engagements.clientId))
    .leftJoin(assignee, eq(assignee.id, tasks.assigneeId))
    .where(
      and(
        visible,
        eq(tasks.status, opts.status ?? "open"),
        opts.mine ? eq(tasks.assigneeId, actor.userId) : undefined,
        opts.clientId ? eq(clients.id, opts.clientId) : undefined,
      ),
    )
    .orderBy(sql`${tasks.dueDate} asc nulls last`, asc(clients.displayName))
    .limit(300);
}

export async function countMyOpenTasks(db: Db, actor: Actor): Promise<number> {
  const visible = visibleClientsCondition(db, actor);
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(tasks)
    .innerJoin(engagements, eq(engagements.id, tasks.engagementId))
    .innerJoin(clients, eq(clients.id, engagements.clientId))
    .where(and(visible, eq(tasks.assigneeId, actor.userId), eq(tasks.status, "open")));
  return row?.n ?? 0;
}
