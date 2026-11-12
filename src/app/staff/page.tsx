import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock, CircleCheck, Plug } from "lucide-react";
import { getDb } from "@/db";
import { SimpleTable, td, tdHide } from "@/components/table";
import { Badge, ButtonLink, EmptyState, Panel, SegmentedLinks, StatStrip } from "@/components/ui";
import { requireStaffActor } from "@/lib/auth/current";
import { formatDate, formatMoney, ROLE_LABELS, STATUS_LABELS } from "@/lib/labels";
import { dueLabel, ENGAGEMENT_TONE } from "@/lib/status";
import { DUE_SOON_DAYS, firmToday, getDashboard } from "@/services/dashboard";
import { invoiceTotals } from "@/services/invoices";
import { paypalConfig } from "@/integrations/paypal";
import { ACTIVITY_LABELS, getPracticeCounts, getWorkload, listAttentionTasks, listRecentClientActivity } from "@/services/insights";

export const metadata: Metadata = { title: "Dashboard" };

const FIRM_TZ = process.env.FIRM_TIMEZONE || "America/New_York";
const timeFmt = new Intl.DateTimeFormat("en-US", { timeZone: FIRM_TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function greeting(now: Date) {
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: FIRM_TZ, hour: "numeric", hourCycle: "h23" }).format(now));
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

export default async function StaffDashboard({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const actor = await requireStaffActor();
  const { view } = await searchParams;
  const mine = view === "mine";
  const now = new Date();
  const db = getDb();
  const [d, counts, attention, workload, activity, billing] = await Promise.all([
    getDashboard(db, actor, { mine, now }),
    getPracticeCounts(db, actor),
    listAttentionTasks(db, actor),
    getWorkload(db, actor),
    listRecentClientActivity(db, actor, 10),
    invoiceTotals(db, actor, firmToday(now), now),
  ]);
  const longDate = new Intl.DateTimeFormat("en-US", { timeZone: FIRM_TZ, weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(now);
  const maxStatus = Math.max(1, ...d.statusBreakdown.map((s) => s.count));

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[12.5px] text-muted">{longDate}</p>
          <h1 className="text-[20px] font-semibold leading-7 tracking-[-0.01em] text-ink">
            {greeting(now)}, {actor.name.split(/\s+/)[0]}
          </h1>
        </div>
        <SegmentedLinks
          label="Scope"
          items={[
            { href: "/staff", label: actor.role === "preparer" ? "My clients" : "Whole firm", active: !mine },
            { href: "/staff?view=mine", label: "Engagements I own", active: mine },
          ]}
        />
      </div>

      <StatStrip
        items={[
          { label: "Active clients", value: d.metrics.activeClients, hint: actor.role === "preparer" ? "Assigned to you" : "Across the firm", href: "/staff/clients" },
          { label: "Open engagements", value: d.metrics.open, hint: `${d.metrics.waitingOnClient} waiting on client`, href: "/staff/engagements" },
          { label: "Pending tax returns", value: counts.pendingReturns, hint: "Not yet filed", href: "/staff/tax-preparation" },
          { label: "Overdue", value: d.metrics.overdue, hint: "Past due date", tone: d.metrics.overdue ? "danger" : "default", href: "/staff/engagements" },
          { label: "Open client requests", value: counts.openClientRequests, hint: "Items requested from clients", tone: counts.openClientRequests ? "warning" : "default", href: "/staff/tasks?view=client" },
          { label: "My open tasks", value: d.metrics.myOpenTasks, hint: `${attention.length} need attention`, href: "/staff/tasks" },
        ]}
      />

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Panel title="Upcoming tax deadlines" description={`Overdue and due within ${DUE_SOON_DAYS} days`} flush actions={<ButtonLink href="/staff/calendar" variant="ghost" size="sm">Calendar</ButtonLink>}>
            {d.deadlines.length === 0 ? (
              <EmptyState icon={<CalendarClock />} title="No deadlines in the next two weeks" />
            ) : (
              <SimpleTable label="Upcoming deadlines" headers={[{ label: "Due" }, { label: "Engagement" }, { label: "Client", hideBelow: "sm" }, { label: "Owner", hideBelow: "md" }, { label: "Status" }]}>
                {d.deadlines.map((e) => {
                  const due = dueLabel(e.dueDate, d.today);
                  return (
                    <tr key={e.id}>
                      <td className={td}>
                        <div className="tabular whitespace-nowrap text-ink">{formatDate(e.dueDate)}</div>
                        <div className={due.tone === "danger" ? "text-[12px] font-medium text-danger-ink" : due.tone === "warn" ? "text-[12px] text-warning-ink" : "text-[12px] text-muted"}>{due.text}</div>
                      </td>
                      <td className={td}>
                        <Link href={`/staff/engagements/${e.id}`} className="font-medium text-ink hover:text-brand hover:underline">{e.title}</Link>
                      </td>
                      <td className={`${td} ${tdHide.sm}`}>
                        <Link href={`/staff/clients/${e.clientId}`} className="text-ink hover:underline">{e.clientName}</Link>
                      </td>
                      <td className={`${td} ${tdHide.md} text-muted`}>{e.ownerName}</td>
                      <td className={td}><Badge tone={ENGAGEMENT_TONE[e.status]} dot>{STATUS_LABELS[e.status]}</Badge></td>
                    </tr>
                  );
                })}
              </SimpleTable>
            )}
          </Panel>

          <Panel title="Tasks requiring attention" description="Your open tasks due within 7 days or overdue" flush actions={<ButtonLink href="/staff/tasks" variant="ghost" size="sm">All tasks</ButtonLink>}>
            {attention.length === 0 ? (
              <EmptyState icon={<CircleCheck />} title="Nothing urgent">Tasks assigned to you that are due soon will appear here.</EmptyState>
            ) : (
              <SimpleTable label="Tasks requiring attention" headers={[{ label: "Task" }, { label: "Client", hideBelow: "sm" }, { label: "Due", align: "right" }]}>
                {attention.map((t) => {
                  const due = dueLabel(t.dueDate, d.today);
                  return (
                    <tr key={t.id}>
                      <td className={td}>
                        <Link href={`/staff/engagements/${t.engagementId}`} className="font-medium text-ink hover:text-brand hover:underline">{t.title}</Link>
                        <div className="text-[12px] text-muted">{t.engagementTitle}</div>
                      </td>
                      <td className={`${td} ${tdHide.sm} text-muted`}>{t.clientName}</td>
                      <td className={`${td} text-right`}><Badge tone={due.tone}>{due.text}</Badge></td>
                    </tr>
                  );
                })}
              </SimpleTable>
            )}
          </Panel>

          <Panel title="Recent client activity" flush>
            {activity.length === 0 ? (
              <EmptyState title="No activity yet" />
            ) : (
              <ol className="divide-y divide-line">
                {activity.map((a) => (
                  <li key={a.id} className="flex items-start gap-3 px-4 py-2.5 text-[13px]">
                    <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-line-strong" />
                    <p className="min-w-0 flex-1 text-ink">
                      <span className="font-medium">{a.actorName ?? "Website"}</span> <span className="text-muted">{ACTIVITY_LABELS[a.action] ?? a.action}</span>
                      {a.clientId ? (
                        <>
                          {" · "}
                          <Link href={`/staff/clients/${a.clientId}`} className="text-ink hover:underline">{a.clientName}</Link>
                        </>
                      ) : null}
                    </p>
                    <time className="tabular shrink-0 text-[12px] text-faint" dateTime={a.createdAt.toISOString()}>{timeFmt.format(a.createdAt)}</time>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </div>

        <div className="space-y-5">
          <Panel title="Work in progress" description="Open engagements by status">
            {d.metrics.open === 0 ? (
              <p className="text-[13px] text-muted">No open engagements.</p>
            ) : (
              <ul className="space-y-2.5" aria-label="Open engagements by status">
                {d.statusBreakdown.map((s) => (
                  <li key={s.status} title={`${STATUS_LABELS[s.status]}: ${s.count}`} className="grid grid-cols-[7.5rem_1fr_2rem] items-center gap-3 text-[12.5px]">
                    <span className="truncate text-ink">{STATUS_LABELS[s.status]}</span>
                    <span className="h-1.5 rounded-sm bg-subtle">
                      <span className="block h-1.5 rounded-sm bg-brand" style={{ width: `${(s.count / maxStatus) * 100}%` }} />
                    </span>
                    <span className="tabular text-right text-muted">{s.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Workload" description="Open work per team member" flush>
            {workload.length === 0 ? (
              <EmptyState title="No team members" />
            ) : (
              <SimpleTable label="Workload" headers={[{ label: "Member" }, { label: "Open", align: "right" }, { label: "Overdue", align: "right" }, { label: "Tasks", align: "right" }]}>
                {workload.map((w) => (
                  <tr key={w.userId}>
                    <td className={td}>
                      <div className="font-medium text-ink">{w.name}</div>
                      <div className="text-[12px] text-muted">{ROLE_LABELS[w.role as keyof typeof ROLE_LABELS]}</div>
                    </td>
                    <td className={`${td} tabular text-right`}>{w.openEngagements}</td>
                    <td className={`${td} tabular text-right ${w.overdue ? "font-medium text-danger-ink" : "text-muted"}`}>{w.overdue}</td>
                    <td className={`${td} tabular text-right`}>{w.openTasks}</td>
                  </tr>
                ))}
              </SimpleTable>
            )}
          </Panel>

          <Panel title="Billing" actions={<ButtonLink href="/staff/invoices" variant="ghost" size="sm">View invoices</ButtonLink>}>
            {paypalConfig().isConfigured ? (
              <dl className="grid grid-cols-2 gap-3 text-[13px]">
                {[
                  ["Outstanding", formatMoney(billing.outstandingCents), billing.outstandingCents ? "text-warning-ink" : "text-ink"],
                  ["Awaiting payment", String(billing.openCount), "text-ink"],
                  ["Overdue", String(billing.overdueCount), billing.overdueCount ? "text-danger-ink" : "text-ink"],
                  ["Paid, last 30 days", formatMoney(billing.paidLast30Cents), "text-success"],
                ].map(([k, v, tone]) => (
                  <div key={k}>
                    <dt className="text-[12px] text-muted">{k}</dt>
                    <dd className={`mt-0.5 text-[16px] font-semibold tabular ${tone}`}>{v}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <EmptyState icon={<Plug />} title="PayPal not connected" action={<ButtonLink href="/staff/integrations" variant="secondary" size="sm">View integrations</ButtonLink>}>
                Invoices and payments appear here once PayPal is connected. No figures are shown until then.
              </EmptyState>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
