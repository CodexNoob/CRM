import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Card, EmptyState, PageHeader, buttonClass, cx } from "@/components/ui";
import { requireStaffActor } from "@/lib/auth/current";
import { APPOINTMENT_KIND_LABELS } from "@/lib/labels";
import { formatTime } from "@/lib/time";
import { getCalendar, type CalendarItem } from "@/services/calendar";
import { listClients } from "@/services/clients";
import { firmToday } from "@/services/dashboard";
import { listStaff } from "@/services/engagements";
import { AppointmentForm, CancelAppointmentButton } from "./calendar-forms";

export const metadata: Metadata = { title: "Deadlines & Calendar" };

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function iso(y: number, m: number, d: number) {
  return new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
}

function itemHref(i: CalendarItem) {
  if (i.kind === "engagement_due") return `/crm/engagements/${i.id}`;
  if (i.kind === "task_due") return `/crm/engagements/${i.engagementId}`;
  return i.clientId ? `/crm/clients/${i.clientId}` : null;
}

const KIND_STYLE: Record<CalendarItem["kind"], { dot: string; label: string }> = {
  appointment: { dot: "bg-brand", label: "Appointment" },
  engagement_due: { dot: "bg-danger", label: "Engagement due" },
  task_due: { dot: "bg-warning", label: "Task due" },
};

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const actor = await requireStaffActor();
  const today = firmToday();
  const sp = await searchParams;
  const match = /^(\d{4})-(\d{2})$/.exec(sp.m ?? "");
  const year = match ? Number(match[1]) : Number(today.slice(0, 4));
  const month = match ? Math.min(Math.max(Number(match[2]) - 1, 0), 11) : Number(today.slice(5, 7)) - 1;

  const first = new Date(Date.UTC(year, month, 1));
  const gridStart = new Date(first);
  gridStart.setUTCDate(1 - first.getUTCDay());
  const days = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setUTCDate(gridStart.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
  const monthStart = iso(year, month, 1);
  const monthEnd = iso(year, month + 1, 1);
  const prev = iso(year, month - 1, 1).slice(0, 7);
  const next = iso(year, month + 1, 1).slice(0, 7);

  const db = getDb();
  const [items, clients, staff] = await Promise.all([getCalendar(db, actor, days[0]!, iso(year, month, 1 - first.getUTCDay() + 42)), listClients(db, actor), listStaff(db, actor)]);
  const byDay = new Map<string, CalendarItem[]>();
  for (const i of items) byDay.set(i.date, [...(byDay.get(i.date) ?? []), i]);
  const monthItems = items.filter((i) => i.date >= monthStart && i.date < monthEnd);

  return (
    <>
      <PageHeader title="Deadlines & Calendar" description="Appointments, engagement due dates and task deadlines in one place." />
      <div className="grid gap-6 xl:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          <Card>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-[15px] font-semibold text-ink">
                {MONTHS[month]} {year}
              </h2>
              <div className="flex items-center gap-2">
                <Link href={`/crm/calendar?m=${prev}`} className={buttonClass("secondary", "w-8 px-0")} aria-label="Previous month"><ChevronLeft /></Link>
                <Link href="/crm/calendar" className={buttonClass("secondary")}>Today</Link>
                <Link href={`/crm/calendar?m=${next}`} className={buttonClass("secondary", "w-8 px-0")} aria-label="Next month"><ChevronRight /></Link>
              </div>
            </div>
            <ul className="mb-3 flex flex-wrap gap-4 text-xs text-muted" aria-label="Legend">
              {Object.values(KIND_STYLE).map((k) => (
                <li key={k.label} className="flex items-center gap-1.5">
                  <span aria-hidden className={cx("size-2 rounded-full", k.dot)} /> {k.label}
                </li>
              ))}
            </ul>

            {/* Month grid (tablet and up) */}
            <div className="hidden overflow-hidden rounded-lg border border-line md:block">
              <div className="grid grid-cols-7 border-b border-line bg-subtle/50 text-xs font-medium text-muted">
                {WEEKDAYS.map((d) => (
                  <div key={d} className="px-2 py-1.5">{d}</div>
                ))}
              </div>
              <div className="grid grid-cols-7">
                {days.map((d) => {
                  const inMonth = d >= monthStart && d < monthEnd;
                  const list = byDay.get(d) ?? [];
                  return (
                    <div key={d} className={cx("min-h-24 border-b border-r border-line p-1.5 [&:nth-child(7n)]:border-r-0", !inMonth && "bg-hover")}>
                      <p className={cx("mb-1 flex size-6 items-center justify-center rounded-full text-xs tabular-nums", d === today ? "bg-brand font-semibold text-white" : inMonth ? "text-ink" : "text-muted/60")}>
                        {Number(d.slice(8))}
                      </p>
                      <ul className="space-y-0.5">
                        {list.slice(0, 3).map((i) => {
                          const href = itemHref(i);
                          const text = i.kind === "appointment" ? `${formatTime(i.startsAt)} ${i.title}` : i.title;
                          const content = (
                            <span className="flex items-center gap-1 truncate rounded px-1 py-0.5 text-[11px] text-ink hover:bg-subtle" title={`${KIND_STYLE[i.kind].label}: ${text}${"clientName" in i && i.clientName ? ` (${i.clientName})` : ""}`}>
                              <span aria-hidden className={cx("size-1.5 shrink-0 rounded-full", KIND_STYLE[i.kind].dot)} />
                              <span className="truncate">{text}</span>
                            </span>
                          );
                          return <li key={`${i.kind}-${i.id}`}>{href ? <Link href={href}>{content}</Link> : content}</li>;
                        })}
                        {list.length > 3 ? <li className="px-1 text-[11px] text-muted">+{list.length - 3} more</li> : null}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </div>
          </Card>

          {/* Agenda (all sizes) */}
          <Card title={`Agenda · ${MONTHS[month]}`}>
            {monthItems.length === 0 ? (
              <EmptyState title="Nothing scheduled this month." />
            ) : (
              <ul className="-my-3 divide-y divide-line">
                {monthItems.map((i) => {
                  const href = itemHref(i);
                  return (
                    <li key={`${i.kind}-${i.id}`} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:gap-4">
                      <div className="w-28 shrink-0 text-sm tabular-nums text-ink">
                        {new Date(`${i.date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })}
                        <span className="block text-xs text-muted">{i.kind === "appointment" ? `${formatTime(i.startsAt)}–${formatTime(i.endsAt)}` : "Due"}</span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-2 text-sm font-medium text-ink">
                          <span aria-hidden className={cx("size-2 shrink-0 rounded-full", KIND_STYLE[i.kind].dot)} />
                          {href ? <Link href={href} className="truncate hover:underline">{i.title}</Link> : <span className="truncate">{i.title}</span>}
                        </p>
                        <p className="truncate text-xs text-muted">
                          {KIND_STYLE[i.kind].label}
                          {i.kind === "appointment" ? ` · ${APPOINTMENT_KIND_LABELS[i.type]} · with ${i.ownerName}${i.location ? ` · ${i.location}` : ""}` : ""}
                          {i.clientName ? ` · ${i.clientName}` : ""}
                        </p>
                      </div>
                      {i.kind === "appointment" ? <CancelAppointmentButton id={i.id} title={i.title} /> : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>

        <div id="new-appointment" className="scroll-mt-20">
        <Card title="New appointment">
          <AppointmentForm
            clients={clients.map((c) => ({ id: c.id, name: c.displayName }))}
            staff={staff.map((s) => ({ id: s.id, name: s.name }))}
            defaultOwnerId={actor.userId}
            defaultStart={`${today}T09:00`}
          />
        </Card>
        </div>
      </div>
    </>
  );
}
