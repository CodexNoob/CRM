import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock, CircleCheck, Plug } from "lucide-react";
import { getDb } from "@/db";
import { SimpleTable, td, tdHide } from "@/components/table";
import { Badge, ButtonLink, EmptyState, Panel, SegmentedLinks, StatStrip } from "@/components/ui";
import { getCurrentFirmAccess, requireStaffActor } from "@/lib/auth/current";
import { formatDate, formatMoney, LEAD_STATUS_LABELS, ROLE_LABELS, SERVICE_LABELS, STATUS_LABELS, TASK_STATUS_LABELS } from "@/lib/labels";
import { dueLabel, ENGAGEMENT_TONE, LEAD_TONE, TASK_TONE } from "@/lib/status";
import { DUE_SOON_DAYS, firmToday, getDashboard, getWorkspaceOverview } from "@/services/dashboard";
import { invoiceTotals } from "@/services/invoices";
import { getQboConnectionView, qboFirmFinancialActionsEnabled } from "@/services/qbo-connections";
import { getWorkload, listWorkspaceActivity, type WorkspaceActivity } from "@/services/insights";

export const metadata: Metadata = { title: "Dashboard" };

const FIRM_TZ = process.env.FIRM_TIMEZONE || "America/New_York";
const timeFmt = new Intl.DateTimeFormat("en-US", { timeZone: FIRM_TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function greeting(now: Date) {
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: FIRM_TZ, hour: "numeric", hourCycle: "h23" }).format(now));
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

/** Horizontal bar list used by the overview panels. */
function Bars({ label, rows }: { label: string; rows: { key: string; name: string; count: number; href?: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <ul className="space-y-2" aria-label={label}>
      {rows.map((r) => (
        <li key={r.key} title={`${r.name}: ${r.count}`} className="grid grid-cols-[8.5rem_1fr_2rem] items-center gap-3 text-[12.5px]">
          {r.href ? (
            <Link href={r.href} className="truncate text-ink hover:text-brand hover:underline">
              {r.name}
            </Link>
          ) : (
            <span className="truncate text-ink">{r.name}</span>
          )}
          <span className="h-1.5 rounded-sm bg-subtle">
            <span className="block h-1.5 rounded-sm bg-brand" style={{ width: `${(r.count / max) * 100}%` }} />
          </span>
          <span className="tabular text-right text-muted">{r.count}</span>
        </li>
      ))}
    </ul>
  );
}

function MiniStat({ label, value, href, tone }: { label: string; value: number | string; href?: string; tone?: "danger" | "warning" | "success" }) {
  const color = tone === "danger" ? "text-danger-ink" : tone === "warning" ? "text-warning-ink" : tone === "success" ? "text-success" : "text-ink";
  const body = (
    <>
      <dt className="text-[12px] text-muted">{label}</dt>
      <dd className={`mt-0.5 text-[16px] font-semibold tabular ${color}`}>{value}</dd>
    </>
  );
  return href ? (
    <Link href={href} className="block rounded-md hover:bg-hover">
      {body}
    </Link>
  ) : (
    <div>{body}</div>
  );
}

const statusLabel = (entityType: string, s: unknown) => {
  if (typeof s !== "string") return "—";
  if (entityType === "lead") return LEAD_STATUS_LABELS[s as keyof typeof LEAD_STATUS_LABELS] ?? s;
  if (entityType === "task") return TASK_STATUS_LABELS[s as keyof typeof TASK_STATUS_LABELS] ?? s;
  return STATUS_LABELS[s as keyof typeof STATUS_LABELS] ?? s;
};

const hrefFor = (a: WorkspaceActivity) =>
  a.entityType === "lead" ? `/crm/leads/${a.entityId}` : a.entityType === "client" ? `/crm/clients/${a.entityId}` : a.entityType === "engagement" ? `/crm/engagements/${a.entityId}` : `/crm/tasks/${a.entityId}`;

/** One readable sentence per event: "<actor> <verb> <record>". */
function describe(a: WorkspaceActivity): { verb: string; extra?: string } {
  const m = a.metadata ?? {};
  switch (`${a.entityType}:${a.type}`) {
    case "lead:system":
      return { verb: a.body === "Inquiry received from the website" ? "received a website inquiry from" : "created lead" };
    case "lead:status_change":
      return { verb: "converted lead", extra: "to a client" };
    case "client:system":
      return { verb: "created client" };
    case "engagement:system":
      return m.kind === "ready_for_review" ? { verb: "completed every task on", extra: "— ready for review" } : { verb: "created engagement" };
    case "engagement:status_change":
      return { verb: "moved", extra: `${statusLabel("engagement", m.from)} → ${statusLabel("engagement", m.to)}` };
    case "task:assignment":
      return { verb: "assigned", extra: a.assigneeName ? `to ${a.assigneeName}` : undefined };
    case "task:status_change":
      return { verb: "completed task" };
    default:
      return { verb: a.body ?? "updated" };
  }
}

export default async function StaffDashboard({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  // Locked firms land here; the layout shows the subscription modal and no CRM data is loaded.
  const actor = await requireStaffActor({ allowLocked: true });
  if ((await getCurrentFirmAccess(actor.firmId)).locked) return <div aria-hidden className="min-h-[60vh]" />;
  const { view } = await searchParams;
  const mine = view === "mine";
  const now = new Date();
  const db = getDb();
  const [d, o, workload, activity, billing, qbo] = await Promise.all([
    getDashboard(db, actor, { mine, now }),
    getWorkspaceOverview(db, actor, { mine, now }),
    getWorkload(db, actor),
    listWorkspaceActivity(db, actor, 15),
    invoiceTotals(db, actor, firmToday(now), now),
    getQboConnectionView(db, { type: "firm", firmId: actor.firmId }, now),
  ]);
  const longDate = new Intl.DateTimeFormat("en-US", { timeZone: FIRM_TZ, weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(now);
  const k = o.kpis;
  const scopeHint = mine ? "Yours" : actor.role === "employee" ? "Your clients" : "Across the firm";

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
            { href: "/crm", label: actor.role === "employee" ? "My clients" : "Whole firm", active: !mine },
            { href: "/crm?view=mine", label: "Mine", active: mine },
          ]}
        />
      </div>

      <StatStrip
        items={[
          { label: "Total clients", value: k.totalClients, hint: scopeHint, href: "/crm/clients" },
          { label: "Active clients", value: k.activeClients, hint: "Status active", href: "/crm/clients?status=active" },
          { label: "New leads", value: k.newLeads, hint: "Not yet contacted", tone: k.newLeads ? "warning" : "default", href: "/crm/leads?status=new" },
          { label: "Active engagements", value: k.activeEngagements, hint: "Approved work", href: "/crm/engagements?status=open" },
          { label: "Tasks due today", value: k.tasksDueToday, hint: mine ? "Assigned to you" : "Open tasks", tone: k.tasksDueToday ? "warning" : "default", href: "/crm/tasks?scope=team&due=today" },
          { label: "Overdue tasks", value: k.overdueTasks, hint: "Past due date", tone: k.overdueTasks ? "danger" : "default", href: "/crm/tasks?scope=team&due=overdue" },
          { label: "Pending client documents", value: k.pendingClientDocuments, hint: "Requested, not received", tone: k.pendingClientDocuments ? "warning" : "default", href: "/crm/tasks?scope=client" },
          { label: "Awaiting review", value: k.awaitingReview, hint: "Under review or all tasks done", href: "/crm/engagements?status=in_review" },
        ]}
      />

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Panel title="Upcoming deadlines" description={`Overdue and due within ${DUE_SOON_DAYS} days`} flush actions={<ButtonLink href="/crm/calendar" variant="ghost" size="sm">Calendar</ButtonLink>}>
            {d.deadlines.length === 0 ? (
              <EmptyState icon={<CalendarClock />} title="No deadlines in the next two weeks" />
            ) : (
              <SimpleTable label="Upcoming deadlines" headers={[{ label: "Due" }, { label: "Engagement" }, { label: "Client", hideBelow: "sm" }, { label: "Manager", hideBelow: "md" }, { label: "Status" }]}>
                {d.deadlines.map((e) => {
                  const due = dueLabel(e.dueDate, d.today);
                  return (
                    <tr key={e.id}>
                      <td className={td}>
                        <div className="tabular whitespace-nowrap text-ink">{formatDate(e.dueDate)}</div>
                        <div className={due.tone === "danger" ? "text-[12px] font-medium text-danger-ink" : due.tone === "warn" ? "text-[12px] text-warning-ink" : "text-[12px] text-muted"}>{due.text}</div>
                      </td>
                      <td className={td}>
                        <Link href={`/crm/engagements/${e.id}`} className="font-medium text-ink hover:text-brand hover:underline">{e.title}</Link>
                      </td>
                      <td className={`${td} ${tdHide.sm}`}>
                        <Link href={`/crm/clients/${e.clientId}`} className="text-ink hover:underline">{e.clientName}</Link>
                      </td>
                      <td className={`${td} ${tdHide.md} text-muted`}>{e.ownerName}</td>
                      <td className={td}><Badge tone={ENGAGEMENT_TONE[e.status]} dot>{STATUS_LABELS[e.status]}</Badge></td>
                    </tr>
                  );
                })}
              </SimpleTable>
            )}
          </Panel>

          <Panel title="My tasks" description="Open tasks assigned to you, soonest due first" flush actions={<ButtonLink href="/crm/tasks" variant="ghost" size="sm">All my tasks</ButtonLink>}>
            {o.myTaskList.length === 0 ? (
              <EmptyState icon={<CircleCheck />} title="Nothing assigned to you">Tasks assigned to you will appear here.</EmptyState>
            ) : (
              <SimpleTable label="My tasks" headers={[{ label: "Task" }, { label: "Client", hideBelow: "sm" }, { label: "Status", hideBelow: "md" }, { label: "Due", align: "right" }]}>
                {o.myTaskList.map((t) => {
                  const due = dueLabel(t.dueDate, o.today);
                  return (
                    <tr key={t.id}>
                      <td className={td}>
                        <Link href={`/crm/tasks/${t.id}`} className="font-medium text-ink hover:text-brand hover:underline">{t.title}</Link>
                        {t.engagementTitle ? <div className="text-[12px] text-muted">{t.engagementTitle}</div> : null}
                      </td>
                      <td className={`${td} ${tdHide.sm} text-muted`}>{t.clientName ?? "Internal"}</td>
                      <td className={`${td} ${tdHide.md}`}><Badge tone={TASK_TONE[t.status]}>{TASK_STATUS_LABELS[t.status]}</Badge></td>
                      <td className={`${td} text-right`}>{t.dueDate ? <Badge tone={due.tone}>{due.text}</Badge> : <span className="text-[12px] text-faint">No date</span>}</td>
                    </tr>
                  );
                })}
              </SimpleTable>
            )}
          </Panel>

          <Panel title="Recent activity" description="Leads, clients, engagements and tasks" flush>
            {activity.length === 0 ? (
              <EmptyState title="No activity yet">New leads, clients, engagements and task updates appear here.</EmptyState>
            ) : (
              <ol className="divide-y divide-line">
                {activity.map((a) => {
                  const s = describe(a);
                  return (
                    <li key={a.id} className="flex items-start gap-3 px-4 py-2.5 text-[13px]">
                      <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-line-strong" />
                      <p className="min-w-0 flex-1 text-ink">
                        <span className="font-medium">{a.actorName ?? "Website"}</span> <span className="text-muted">{s.verb}</span>{" "}
                        <Link href={hrefFor(a)} className="font-medium text-ink hover:text-brand hover:underline">
                          {a.entityName ?? "a record"}
                        </Link>
                        {s.extra ? <span className="text-muted"> {s.extra}</span> : null}
                      </p>
                      <time className="tabular shrink-0 text-[12px] text-faint" dateTime={a.occurredAt.toISOString()}>{timeFmt.format(a.occurredAt)}</time>
                    </li>
                  );
                })}
              </ol>
            )}
          </Panel>

          <Panel title="Workload" description="Open work per team member" flush>
            {workload.length === 0 ? (
              <EmptyState title="No team members" />
            ) : (
              <SimpleTable label="Workload" headers={[{ label: "Member" }, { label: "Engagements", align: "right" }, { label: "Overdue", align: "right" }, { label: "In review", align: "right", hideBelow: "sm" }, { label: "Tasks", align: "right" }]}>
                {workload.map((w) => (
                  <tr key={w.userId}>
                    <td className={td}>
                      <div className="font-medium text-ink">{w.name}</div>
                      <div className="text-[12px] text-muted">{ROLE_LABELS[w.role as keyof typeof ROLE_LABELS]}</div>
                    </td>
                    <td className={`${td} tabular text-right`}>{w.openEngagements}</td>
                    <td className={`${td} tabular text-right ${w.overdue ? "font-medium text-danger-ink" : "text-muted"}`}>{w.overdue}</td>
                    <td className={`${td} ${tdHide.sm} tabular text-right text-muted`}>{w.inReview}</td>
                    <td className={`${td} tabular text-right`}>{w.openTasks}</td>
                  </tr>
                ))}
              </SimpleTable>
            )}
          </Panel>
        </div>

        <div className="space-y-5">
          <Panel title="Leads" description="Pipeline by stage" actions={<ButtonLink href="/crm/leads" variant="ghost" size="sm">Pipeline</ButtonLink>}>
            <dl className="mb-4 grid grid-cols-2 gap-3 text-[13px]">
              <MiniStat label="Conversion rate" value={o.conversionRate === null ? "—" : `${o.conversionRate}%`} />
              <MiniStat label="Follow-ups due" value={o.followUpCount} href="/crm/leads?followup=due" tone={o.followUpCount ? "warning" : undefined} />
            </dl>
            <Bars label="Leads by stage" rows={o.leadsByStage.map((s) => ({ key: s.status, name: LEAD_STATUS_LABELS[s.status], count: s.count, href: `/crm/leads?status=${s.status}` }))} />
            {o.followUps.length ? (
              <div className="mt-4">
                <h3 className="mb-1.5 text-[12px] font-medium text-muted">Needs follow-up</h3>
                <ul className="space-y-1 text-[13px]">
                  {o.followUps.map((l) => {
                    const due = dueLabel(l.followUpDate, o.today);
                    return (
                      <li key={l.id} className="flex items-center justify-between gap-2">
                        <Link href={`/crm/leads/${l.id}`} className="min-w-0 truncate text-ink hover:text-brand hover:underline">{l.company ? `${l.name} · ${l.company}` : l.name}</Link>
                        <Badge tone={due.tone}>{due.text}</Badge>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
            {o.recentLeads.length ? (
              <div className="mt-4">
                <h3 className="mb-1.5 text-[12px] font-medium text-muted">Recent leads</h3>
                <ul className="space-y-1 text-[13px]">
                  {o.recentLeads.map((l) => (
                    <li key={l.id} className="flex items-center justify-between gap-2">
                      <Link href={`/crm/leads/${l.id}`} className="min-w-0 truncate text-ink hover:text-brand hover:underline">{l.company ? `${l.name} · ${l.company}` : l.name}</Link>
                      <Badge tone={LEAD_TONE[l.status]}>{LEAD_STATUS_LABELS[l.status]}</Badge>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </Panel>

          <Panel title="Engagements" description="Open work by service" actions={<ButtonLink href="/crm/engagements" variant="ghost" size="sm">All</ButtonLink>}>
            <dl className="mb-4 grid grid-cols-2 gap-3 text-[13px]">
              <MiniStat label="Active" value={k.activeEngagements} href="/crm/engagements?status=open" />
              <MiniStat label="Awaiting review" value={k.awaitingReview} href="/crm/engagements?status=in_review" tone={k.awaitingReview ? "warning" : undefined} />
            </dl>
            {o.engagementsByService.length ? (
              <Bars label="Engagements by service" rows={o.engagementsByService.map((s) => ({ key: s.serviceType, name: SERVICE_LABELS[s.serviceType], count: s.count, href: `/crm/engagements?service=${s.serviceType}` }))} />
            ) : (
              <p className="text-[13px] text-muted">No open engagements.</p>
            )}
            {o.awaitingReviewList.length ? (
              <div className="mt-4">
                <h3 className="mb-1.5 text-[12px] font-medium text-muted">Awaiting review</h3>
                <ul className="space-y-1 text-[13px]">
                  {o.awaitingReviewList.map((e) => (
                    <li key={e.id} className="flex items-center justify-between gap-2">
                      <Link href={`/crm/engagements/${e.id}`} className="min-w-0 truncate text-ink hover:text-brand hover:underline">
                        {e.title} <span className="text-muted">· {e.clientName}</span>
                      </Link>
                      <Badge tone={e.reason === "in_review" ? "brand" : "warn"}>{e.reason === "in_review" ? "Under review" : "Tasks done"}</Badge>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </Panel>

          <Panel title="Tasks" description={mine ? "Your tasks" : "Open tasks you can see"} actions={<ButtonLink href="/crm/tasks" variant="ghost" size="sm">All tasks</ButtonLink>}>
            <dl className="mb-4 grid grid-cols-3 gap-3 text-[13px]">
              <MiniStat label="Mine" value={o.tasks.myOpen} href="/crm/tasks" />
              <MiniStat label="Team" value={o.tasks.teamOpen} href="/crm/tasks" />
              <MiniStat label="Done (7 days)" value={o.tasks.completed7d} href="/crm/tasks?scope=team&status=done" tone="success" />
              <MiniStat label="Due today" value={o.tasks.dueToday} href="/crm/tasks?scope=team&due=today" tone={o.tasks.dueToday ? "warning" : undefined} />
              <MiniStat label="Overdue" value={o.tasks.overdue} href="/crm/tasks?scope=team&due=overdue" tone={o.tasks.overdue ? "danger" : undefined} />
            </dl>
            <Bars label="Tasks by status" rows={o.tasks.byStatus.map((s) => ({ key: s.status, name: s.status === "completed" ? "Completed (7 days)" : TASK_STATUS_LABELS[s.status], count: s.count, href: `/crm/tasks?scope=team&status=${s.status}` }))} />
          </Panel>

          <Panel title="Billing" actions={<ButtonLink href="/crm/invoices" variant="ghost" size="sm">View invoices</ButtonLink>}>
            {qbo.status === "connected" && qboFirmFinancialActionsEnabled() ? (
              <dl className="grid grid-cols-2 gap-3 text-[13px]">
                {[
                  ["Outstanding", formatMoney(billing.outstandingCents), billing.outstandingCents ? "text-warning-ink" : "text-ink"],
                  ["Awaiting payment", String(billing.openCount), "text-ink"],
                  ["Overdue", String(billing.overdueCount), billing.overdueCount ? "text-danger-ink" : "text-ink"],
                  ["Paid, last 30 days", formatMoney(billing.paidLast30Cents), "text-success"],
                ].map(([label, v, tone]) => (
                  <div key={label}>
                    <dt className="text-[12px] text-muted">{label}</dt>
                    <dd className={`mt-0.5 text-[16px] font-semibold tabular ${tone}`}>{v}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <EmptyState icon={<Plug />} title="QuickBooks billing not ready" action={<ButtonLink href="/crm/integrations" variant="secondary" size="sm">View integrations</ButtonLink>}>
                Verify the firm’s QuickBooks connection and sandbox invoice/payment workflow before enabling financial actions.
              </EmptyState>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
