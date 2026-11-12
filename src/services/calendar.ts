import { and, asc, eq, gte, isNotNull, isNull, lt, ne, notInArray, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "@/db";
import { appointments, clients, engagements, tasks, users, type Appointment, type AppointmentKind } from "@/db/schema";
import type { Actor } from "@/lib/auth/actor";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { localDate, zonedLocalToUtc } from "@/lib/time";
import { appointmentInputSchema, isUuid, parseInput } from "@/lib/validation";
import { assertActiveStaffUser, assertClientAccess, requireStaff, visibleClientsCondition } from "./access";
import { recordAudit } from "./audit";

export async function createAppointment(db: Db, actor: Actor, input: unknown): Promise<Appointment> {
  requireStaff(actor);
  const data = parseInput(appointmentInputSchema, input);
  if (data.clientId) await assertClientAccess(db, actor, data.clientId);
  await assertActiveStaffUser(db, data.ownerId, "ownerId");
  const startsAt = zonedLocalToUtc(data.startsAt);
  const endsAt = new Date(startsAt.getTime() + data.durationMinutes * 60_000);
  const [appt] = await db
    .insert(appointments)
    .values({
      title: data.title,
      clientId: data.clientId ?? null,
      ownerId: data.ownerId,
      kind: data.clientId ? data.kind : "internal",
      startsAt,
      endsAt,
      location: data.location ?? null,
      notes: data.notes ?? null,
      createdById: actor.userId,
    })
    .returning();
  await recordAudit(db, { actorUserId: actor.userId, action: "appointment.create", entityType: "appointment", entityId: appt!.id });
  return appt!;
}

export async function cancelAppointment(db: Db, actor: Actor, id: string): Promise<void> {
  requireStaff(actor);
  if (!isUuid(id)) throw new NotFoundError();
  const [appt] = await db.select().from(appointments).where(eq(appointments.id, id));
  if (!appt || appt.cancelledAt) throw new NotFoundError();
  if (appt.clientId) await assertClientAccess(db, actor, appt.clientId);
  await db.update(appointments).set({ cancelledAt: new Date(), updatedAt: new Date() }).where(eq(appointments.id, id));
  await recordAudit(db, { actorUserId: actor.userId, action: "appointment.cancel", entityType: "appointment", entityId: id });
}

export type CalendarItem =
  | { kind: "appointment"; id: string; date: string; startsAt: Date; endsAt: Date; title: string; clientId: string | null; clientName: string | null; ownerName: string; type: AppointmentKind; location: string | null }
  | { kind: "engagement_due"; id: string; date: string; title: string; clientId: string; clientName: string }
  | { kind: "task_due"; id: string; date: string; title: string; engagementId: string; clientName: string };

/**
 * Everything dated between two firm-local dates (inclusive start, exclusive end):
 * appointments, engagement due dates and open task due dates the actor can see.
 * Internal appointments (no client) are visible to all staff.
 */
export async function getCalendar(db: Db, actor: Actor, fromDate: string, toDate: string): Promise<CalendarItem[]> {
  const visible = visibleClientsCondition(db, actor);
  const from = zonedLocalToUtc(`${fromDate}T00:00`);
  const to = zonedLocalToUtc(`${toDate}T00:00`);
  const owner = alias(users, "appt_owner");

  const [appts, dueEngagements, dueTasks] = await Promise.all([
    db
      .select({ a: appointments, clientName: clients.displayName, ownerName: owner.name })
      .from(appointments)
      .leftJoin(clients, eq(clients.id, appointments.clientId))
      .innerJoin(owner, eq(owner.id, appointments.ownerId))
      .where(and(isNull(appointments.cancelledAt), gte(appointments.startsAt, from), lt(appointments.startsAt, to), or(isNull(appointments.clientId), visible ?? sql`true`)))
      .orderBy(asc(appointments.startsAt)),
    db
      .select({ id: engagements.id, title: engagements.title, dueDate: engagements.dueDate, clientId: clients.id, clientName: clients.displayName })
      .from(engagements)
      .innerJoin(clients, eq(clients.id, engagements.clientId))
      .where(and(visible, isNotNull(engagements.dueDate), gte(engagements.dueDate, fromDate), lt(engagements.dueDate, toDate), notInArray(engagements.status, ["completed", "filed"]))),
    db
      .select({ id: tasks.id, title: tasks.title, dueDate: tasks.dueDate, engagementId: engagements.id, clientName: clients.displayName })
      .from(tasks)
      .innerJoin(engagements, eq(engagements.id, tasks.engagementId))
      .innerJoin(clients, eq(clients.id, engagements.clientId))
      .where(and(visible, eq(tasks.status, "open"), isNotNull(tasks.dueDate), gte(tasks.dueDate, fromDate), lt(tasks.dueDate, toDate))),
  ]);

  const items: CalendarItem[] = [
    ...appts.map((r) => ({
      kind: "appointment" as const,
      id: r.a.id,
      date: localDate(r.a.startsAt),
      startsAt: r.a.startsAt,
      endsAt: r.a.endsAt,
      title: r.a.title,
      clientId: r.a.clientId,
      clientName: r.clientName,
      ownerName: r.ownerName,
      type: r.a.kind,
      location: r.a.location,
    })),
    ...dueEngagements.map((e) => ({ kind: "engagement_due" as const, id: e.id, date: e.dueDate!, title: e.title, clientId: e.clientId, clientName: e.clientName })),
    ...dueTasks.map((t) => ({ kind: "task_due" as const, id: t.id, date: t.dueDate!, title: t.title, engagementId: t.engagementId, clientName: t.clientName })),
  ];
  const sortKey = (i: CalendarItem) => (i.kind === "appointment" ? i.startsAt.getTime() : Date.parse(`${i.date}T23:59:59Z`));
  return items.sort((a, b) => a.date.localeCompare(b.date) || sortKey(a) - sortKey(b));
}

/** Upcoming client-facing appointments for the portal. */
export async function listPortalAppointments(db: Db, actor: Actor, now = new Date()) {
  if (actor.role !== "client" || !actor.clientId) throw new ForbiddenError();
  return db
    .select({ id: appointments.id, title: appointments.title, startsAt: appointments.startsAt, endsAt: appointments.endsAt, kind: appointments.kind, location: appointments.location, withName: users.name })
    .from(appointments)
    .innerJoin(users, eq(users.id, appointments.ownerId))
    .where(and(eq(appointments.clientId, actor.clientId), isNull(appointments.cancelledAt), ne(appointments.kind, "internal"), gte(appointments.endsAt, now)))
    .orderBy(asc(appointments.startsAt))
    .limit(20);
}

export async function countUpcomingAppointments(db: Db, actor: Actor, days = 7, now = new Date()): Promise<number> {
  const visible = visibleClientsCondition(db, actor);
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(appointments)
    .leftJoin(clients, eq(clients.id, appointments.clientId))
    .where(
      and(
        isNull(appointments.cancelledAt),
        gte(appointments.startsAt, now),
        lt(appointments.startsAt, new Date(now.getTime() + days * 86_400_000)),
        eq(appointments.ownerId, actor.userId),
        or(isNull(appointments.clientId), visible ?? sql`true`),
      ),
    );
  return row?.n ?? 0;
}
