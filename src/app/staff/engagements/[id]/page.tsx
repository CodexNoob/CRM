import type { Metadata } from "next";
import Link from "next/link";
import { and, desc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Briefcase, FileText, MessageSquare, Receipt, SquareCheckBig, Users } from "lucide-react";
import { getDb } from "@/db";
import { invoices, taskDependencies, tasks as tasksTable } from "@/db/schema";
import { uploadEngagementDocumentAction } from "@/app/actions/engagements";
import { DocumentList, UploadForm } from "@/components/documents";
import { SimpleTable, td, tdHide } from "@/components/table";
import { Alert, Badge, ButtonLink, DescriptionList, EmptyState, Panel, TabNav } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { requireStaffActor } from "@/lib/auth/current";
import {
  BILLING_FREQUENCY_LABELS,
  formatDate,
  formatMoney,
  INVOICE_STATUS_LABELS,
  PORTAL_STATUS,
  PRIORITY_LABELS,
  PROPOSAL_STATUS_LABELS,
  recordNumber,
  SERVICE_LABELS,
  STATUS_LABELS,
  TASK_STATUS_LABELS,
} from "@/lib/labels";
import { orNotFound } from "@/lib/page-helpers";
import { dueLabel, ENGAGEMENT_DONE, ENGAGEMENT_TONE, INVOICE_TONE, PRIORITY_TONE, TASK_OPEN, TASK_TONE } from "@/lib/status";
import { inFirm } from "@/services/access";
import { firmToday } from "@/services/dashboard";
import { listClientDocuments } from "@/services/documents";
import { getEngagement, listStaff } from "@/services/engagements";
import { listEntityTimeline, listStatusHistory } from "@/services/timeline";
import { listEngagementWorkflows, listTemplates } from "@/services/workflows";
import { ClientTimeline } from "../../clients/[id]/client-timeline";
import {
  AddTaskButton,
  CloseEngagementButton,
  EditEngagementButton,
  EditTeamButton,
  GenerateWorkflowButton,
  MoveToReviewButton,
  OverrideWorkForm,
  ProposalControls,
  StatusMenu,
  TaskStatusMenu,
} from "./engagement-controls";

export const metadata: Metadata = { title: "Engagement" };

const TABS = ["overview", "tasks", "documents", "team", "activity", "billing"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABELS: Record<Tab, string> = { overview: "Overview", tasks: "Tasks", documents: "Documents", team: "Team", activity: "Activities", billing: "Billing" };
const TEAM_ROLE_LABELS = { manager: "Engagement manager", staff: "Staff", reviewer: "Reviewer" } as const;
const teamTone = (r: "manager" | "staff" | "reviewer") => (r === "manager" ? "brand" : r === "reviewer" ? "info" : "neutral");

type Detail = Awaited<ReturnType<typeof getEngagement>>;
type Ctx = {
  detail: Detail;
  actor: Awaited<ReturnType<typeof requireStaffActor>>;
  today: string;
  staff: Awaited<ReturnType<typeof listStaff>>;
  staffNames: Record<string, string>;
  base: string;
  perms: { edit: boolean; assign: boolean; approve: boolean; manage: boolean; tasks: boolean; taskEdit: boolean; taskAssign: boolean };
  blocked: Set<string>;
};

export default async function EngagementPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; created?: string }> }) {
  const actor = await requireStaffActor();
  const { id } = await params;
  const sp = await searchParams;
  const db = getDb();
  const today = firmToday();
  const detail = await orNotFound(getEngagement(db, actor, id, today));
  const { engagement: e, tasks, progress, team } = detail;
  const canBilling = can(actor, "billing", "view");
  const tabs = TABS.filter((t) => t !== "billing" || canBilling);
  const tab: Tab = (tabs as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as Tab) : "overview";
  const perms = {
    edit: can(actor, "engagements", "edit") && e.status !== "closed",
    assign: can(actor, "engagements", "assign"),
    approve: can(actor, "engagements", "approve"),
    manage: can(actor, "engagements", "manage"),
    tasks: can(actor, "tasks", "create") && e.status !== "closed",
    taskEdit: can(actor, "tasks", "edit") && e.status !== "closed",
    taskAssign: can(actor, "tasks", "assign"),
  };
  const staff = await listStaff(db, actor);
  const staffNames = Object.fromEntries(staff.map((s) => [s.id, s.name]));
  const base = `/staff/engagements/${e.id}`;
  const done = ENGAGEMENT_DONE.includes(e.status);
  const due = dueLabel(e.dueDate, today);
  const showReady = progress.readyForReview && !["in_review", "completed", "filed", "closed", "cancelled"].includes(e.status);

  // Open tasks waiting on unfinished prerequisites (read-only; access to the engagement was checked above).
  const taskIds = tasks.map((t) => t.id);
  const dep = alias(tasksTable, "dep");
  const blocked = new Set(
    taskIds.length
      ? (
          await db
            .select({ taskId: taskDependencies.taskId, depStatus: dep.status })
            .from(taskDependencies)
            .innerJoin(dep, eq(dep.id, taskDependencies.dependsOnTaskId))
            .where(and(inFirm(taskDependencies.firmId, actor), inArray(taskDependencies.taskId, taskIds)))
        )
          .filter((r) => r.depStatus !== "completed" && r.depStatus !== "cancelled")
          .map((r) => r.taskId)
      : [],
  );
  const ctx: Ctx = { detail, actor, today, staff, staffNames, base, perms, blocked };

  const formInitial = {
    title: e.title,
    serviceType: e.serviceType,
    description: e.description,
    taxYear: e.taxYear,
    periodStart: e.periodStart,
    periodEnd: e.periodEnd,
    startDate: e.startDate,
    dueDate: e.dueDate,
    ownerId: e.ownerId,
    feeCents: e.feeCents,
    billingFrequency: e.billingFrequency,
    priority: e.priority,
    proposalStatus: e.proposalStatus,
    acceptedOn: e.acceptedOn,
  };

  return (
    <div className="space-y-5">
      {sp.created === "1" && !tasks.length ? (
        <Alert tone="success" title="Engagement created">
          Next: generate the tasks from a workflow template, or add tasks one by one on the Tasks tab.
        </Alert>
      ) : null}

      <div className="rounded-lg border border-line bg-surface">
        <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <p className="text-[12px] text-muted">{recordNumber("E", e.engagementNumber)}</p>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[18px] font-semibold leading-7 text-ink">{e.title}</h1>
              <Badge tone={ENGAGEMENT_TONE[e.status]} dot>{STATUS_LABELS[e.status]}</Badge>
              {e.proposalStatus !== "not_required" ? (
                <Badge tone={e.proposalStatus === "accepted" ? "good" : e.proposalStatus === "declined" ? "neutral" : "warn"}>Proposal {PROPOSAL_STATUS_LABELS[e.proposalStatus].toLowerCase()}</Badge>
              ) : null}
              {e.priority !== "normal" ? <Badge tone={PRIORITY_TONE[e.priority]}>{PRIORITY_LABELS[e.priority]} priority</Badge> : null}
            </div>
            <p className="mt-0.5 text-[13px] text-muted">
              <Link href={`/staff/clients/${e.clientId}`} className="text-ink hover:underline">{detail.clientName}</Link>
              {" · "}
              {SERVICE_LABELS[e.serviceType]}
              {" · "}
              {progress.total ? `${progress.percent}% complete` : "No tasks yet"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {perms.edit ? <StatusMenu id={e.id} status={e.status} canApprove={perms.approve} /> : null}
            {perms.edit ? <EditEngagementButton id={e.id} staff={staff} initial={formInitial} canAssign={perms.assign} actorId={actor.userId} /> : null}
            {perms.approve && (e.status === "completed" || e.status === "filed") ? <CloseEngagementButton id={e.id} /> : null}
            <ButtonLink href={`/staff/clients/${e.clientId}?tab=messages`} variant="secondary">
              <MessageSquare /> Message client
            </ButtonLink>
          </div>
        </div>
        <dl className="grid grid-cols-2 border-t border-line text-[13px] sm:grid-cols-4">
          {[
            ["Manager", detail.ownerName],
            [
              "Due",
              <span key="d" className="flex flex-wrap items-center gap-2">
                <span className="tabular">{formatDate(e.dueDate)}</span>
                {e.dueDate && !done ? <Badge tone={due.tone}>{due.text}</Badge> : null}
              </span>,
            ],
            ["Tasks", `${progress.open} open · ${progress.completed} done${progress.overdue ? ` · ${progress.overdue} overdue` : ""}`],
            ["Fee", e.feeCents !== null ? `${formatMoney(e.feeCents)}${e.billingFrequency ? ` · ${BILLING_FREQUENCY_LABELS[e.billingFrequency]}` : ""}` : "—"],
          ].map(([k, v]) => (
            <div key={k as string} className="border-r border-line px-4 py-2.5 last:border-r-0">
              <dt className="text-[12px] text-muted">{k}</dt>
              <dd className="mt-0.5 font-medium text-ink">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="border-t border-line px-4 py-2.5">
          <div className="h-2 overflow-hidden rounded-full bg-subtle" role="progressbar" aria-label="Task progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent}>
            <div className="h-full rounded-full bg-brand" style={{ width: `${progress.percent}%` }} />
          </div>
        </div>
        <div className="border-t border-line px-4">
          <TabNav
            label="Engagement sections"
            items={tabs.map((t) => ({ href: t === "overview" ? base : `${base}?tab=${t}`, label: TAB_LABELS[t], active: tab === t, count: t === "tasks" ? progress.open : t === "team" ? team.length : undefined }))}
          />
        </div>
      </div>

      {showReady ? (
        <Alert tone="info" title="Ready for review">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>All tasks are completed. Review the work before the engagement is completed and closed.</span>
            {perms.edit ? <MoveToReviewButton id={e.id} /> : null}
          </div>
        </Alert>
      ) : null}

      {tab === "overview" ? <Overview ctx={ctx} /> : null}
      {tab === "tasks" ? <TasksTab ctx={ctx} /> : null}
      {tab === "documents" ? <DocumentsTab ctx={ctx} /> : null}
      {tab === "team" ? <TeamTab ctx={ctx} /> : null}
      {tab === "activity" ? <ActivityTab ctx={ctx} /> : null}
      {tab === "billing" && canBilling ? <BillingTab ctx={ctx} /> : null}
    </div>
  );
}

function TeamList({ team }: { team: Detail["team"] }) {
  if (!team.length) return <p className="text-[13px] text-muted">No team members yet.</p>;
  return (
    <ul className="space-y-2 text-[13px]">
      {team.map((m) => (
        <li key={m.userId} className="flex items-center justify-between gap-2">
          <span className="text-ink">{m.name}</span>
          <Badge tone={teamTone(m.role)}>{TEAM_ROLE_LABELS[m.role]}</Badge>
        </li>
      ))}
    </ul>
  );
}

async function Overview({ ctx }: { ctx: Ctx }) {
  const { detail, actor, staffNames, base, perms } = ctx;
  const e = detail.engagement;
  const { progress } = detail;
  const recent = await listEntityTimeline(getDb(), actor, "engagement", e.id, 5);
  const overridden = e.workOverrideById && e.proposalStatus !== "accepted" && e.proposalStatus !== "not_required";
  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_22rem]">
      <div className="space-y-5">
        <Panel title="Scope and terms">
          <DescriptionList
            items={[
              ["Scope of work", e.description ? <span className="whitespace-pre-line">{e.description}</span> : null],
              ["Service", SERVICE_LABELS[e.serviceType]],
              ["Tax year", e.taxYear],
              ["Accounting period", e.periodStart || e.periodEnd ? `${formatDate(e.periodStart)} – ${formatDate(e.periodEnd)}` : null],
              ["Start date", e.startDate ? formatDate(e.startDate) : null],
              ["Due date", e.dueDate ? formatDate(e.dueDate) : null],
              ["Fee", e.feeCents !== null ? formatMoney(e.feeCents) : null],
              ["Billing", e.billingFrequency ? BILLING_FREQUENCY_LABELS[e.billingFrequency] : null],
              ["Completed", e.completedAt ? formatDate(e.completedAt.toISOString().slice(0, 10)) : null],
              ["Closed", e.closedAt ? formatDate(e.closedAt.toISOString().slice(0, 10)) : null],
            ]}
          />
        </Panel>
        <Panel title="Progress">
          <dl className="grid grid-cols-2 gap-3 text-[13px] sm:grid-cols-4">
            {(
              [
                ["Complete", `${progress.percent}%`],
                ["Outstanding", progress.open],
                ["Overdue", progress.overdue],
                ["Total tasks", progress.total],
              ] as const
            ).map(([k, v]) => (
              <div key={k}>
                <dt className="text-[12px] text-muted">{k}</dt>
                <dd className={"mt-0.5 text-[16px] font-semibold tabular " + (k === "Overdue" && progress.overdue ? "text-danger-ink" : "text-ink")}>{v}</dd>
              </div>
            ))}
          </dl>
        </Panel>
        <Panel title="Recent activity" flush actions={<ButtonLink href={`${base}?tab=activity`} variant="ghost" size="sm">View all</ButtonLink>}>
          <ClientTimeline items={recent} staffNames={staffNames} emptyText="No activity yet." />
        </Panel>
      </div>
      <div className="space-y-5">
        <Panel title="Proposal and acceptance">
          <div className="space-y-3 text-[13px]">
            <p>
              <span className="text-muted">Status: </span>
              <span className="font-medium text-ink">{PROPOSAL_STATUS_LABELS[e.proposalStatus]}</span>
              {e.acceptedOn ? <span className="text-muted"> · accepted {formatDate(e.acceptedOn)}</span> : null}
            </p>
            {detail.workAllowed ? (
              <p className="text-muted">{overridden ? `${staffNames[e.workOverrideById!] ?? "A manager"} allowed work to start before acceptance.` : "Work can proceed."}</p>
            ) : (
              <Alert tone="warning">Work can’t start until the client accepts the proposal.</Alert>
            )}
            <ProposalControls id={e.id} proposal={e.proposalStatus} canApprove={perms.approve} canEdit={perms.edit} />
            {!detail.workAllowed && perms.approve && perms.edit ? <OverrideWorkForm id={e.id} /> : null}
          </div>
        </Panel>
        <Panel title="Team" actions={<ButtonLink href={`${base}?tab=team`} variant="ghost" size="sm">Manage</ButtonLink>}>
          <TeamList team={detail.team} />
        </Panel>
        <Panel title="Client portal view">
          <p className="text-[13px] font-medium text-ink">{PORTAL_STATUS[e.status].label}</p>
          <p className="mt-0.5 text-[12.5px] text-muted">{PORTAL_STATUS[e.status].description}</p>
        </Panel>
      </div>
    </div>
  );
}

async function TasksTab({ ctx }: { ctx: Ctx }) {
  const { detail, actor, today, staff, perms, blocked } = ctx;
  const e = detail.engagement;
  const { tasks, progress } = detail;
  const db = getDb();
  const [templates, workflows] = await Promise.all([listTemplates(db, actor, { activeOnly: true }), listEngagementWorkflows(db, actor, e.id)]);
  const generated = new Set(workflows.map((w) => w.templateId));
  const defaultTemplate = templates.find((t) => t.serviceType === e.serviceType && !generated.has(t.id)) ?? templates.find((t) => !generated.has(t.id)) ?? null;
  const groups = [
    ...workflows.map((w) => ({ key: w.id, label: `Workflow: ${w.templateName}`, items: tasks.filter((t) => t.workflowInstanceId === w.id) })),
    { key: "other", label: workflows.length ? "Other tasks" : "Tasks", items: tasks.filter((t) => !t.workflowInstanceId || !workflows.some((w) => w.id === t.workflowInstanceId)) },
  ].filter((g) => g.items.length);
  const finished = ENGAGEMENT_DONE.includes(e.status);
  return (
    <Panel
      title="Tasks"
      description={`${progress.open} open · ${progress.completed} completed${progress.overdue ? ` · ${progress.overdue} overdue` : ""}`}
      flush
      actions={
        perms.tasks ? (
          <div className="flex flex-wrap gap-2">
            <AddTaskButton engagementId={e.id} staff={staff} tasks={tasks.filter((t) => TASK_OPEN.includes(t.status)).map((t) => ({ id: t.id, title: t.title }))} canAssign={perms.taskAssign} actorId={actor.userId} />
            {perms.manage && !finished ? (
              <GenerateWorkflowButton
                engagementId={e.id}
                templates={templates.map((t) => ({ id: t.id, name: t.name, steps: t.steps.length }))}
                defaultTemplateId={defaultTemplate?.id ?? null}
                staff={staff}
                generatedTemplateIds={[...generated]}
              />
            ) : null}
          </div>
        ) : null
      }
    >
      {tasks.length ? (
        groups.map((g) => (
          <div key={g.key}>
            {workflows.length ? <h3 className="border-b border-line bg-hover px-4 py-1.5 text-[12px] font-medium text-muted">{g.label}</h3> : null}
            <ul className="divide-y divide-line">
              {g.items.map((t) => {
                const d = dueLabel(t.dueDate, today);
                const open = TASK_OPEN.includes(t.status);
                return (
                  <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                    {t.sequence ? <span className="w-5 text-right text-[12px] tabular text-faint">{t.sequence}</span> : null}
                    <div className="min-w-0 flex-1">
                      <Link href={`/staff/tasks/${t.id}`} className={"text-[13px] hover:text-brand hover:underline " + (open ? "font-medium text-ink" : "text-faint line-through")}>
                        {t.title}
                      </Link>
                      <p className="text-[12px] text-muted">
                        {recordNumber("T", t.taskNumber)} · {t.isClientTask ? "Client request · visible in portal" : (t.assigneeName ?? "Unassigned")}
                      </p>
                    </div>
                    {blocked.has(t.id) && open ? <Badge tone="danger">Waiting on another task</Badge> : null}
                    {t.priority === "high" || t.priority === "urgent" ? <Badge tone={PRIORITY_TONE[t.priority]}>{PRIORITY_LABELS[t.priority]}</Badge> : null}
                    <Badge tone={TASK_TONE[t.status]} dot>{TASK_STATUS_LABELS[t.status]}</Badge>
                    {t.dueDate ? <Badge tone={open ? d.tone : "neutral"}>{open ? d.text : formatDate(t.dueDate)}</Badge> : null}
                    {perms.taskEdit ? <TaskStatusMenu engagementId={e.id} taskId={t.id} title={t.title} status={t.status} /> : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ))
      ) : (
        <EmptyState icon={<SquareCheckBig />} title="No tasks yet">
          {perms.manage ? "Generate the standard task list from a workflow template, or add tasks one by one." : "Add internal steps, or client requests the client will see in their portal."}
        </EmptyState>
      )}
    </Panel>
  );
}

async function DocumentsTab({ ctx }: { ctx: Ctx }) {
  const e = ctx.detail.engagement;
  const docs = (await listClientDocuments(getDb(), ctx.actor, e.clientId)).filter((d) => d.engagementId === e.id);
  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_22rem]">
      <Panel title="Engagement documents" flush>
        {docs.length ? (
          <DocumentList docs={docs.map((d) => ({ ...d, createdAt: d.createdAt.toISOString() }))} staff />
        ) : (
          <EmptyState icon={<FileText />} title="No documents linked to this engagement" />
        )}
      </Panel>
      {ctx.perms.edit ? (
        <Panel title="Upload">
          <UploadForm action={uploadEngagementDocumentAction.bind(null, e.id)} staff label="Add a file to this engagement" compact />
        </Panel>
      ) : null}
    </div>
  );
}

function TeamTab({ ctx }: { ctx: Ctx }) {
  const { detail, staff, perms } = ctx;
  const e = detail.engagement;
  return (
    <Panel
      title="Team"
      description="Everyone on the team can open this client. Changes are recorded on the timeline."
      flush
      actions={perms.assign && perms.edit ? <EditTeamButton engagementId={e.id} ownerId={e.ownerId} staff={staff} team={detail.team.map((m) => ({ userId: m.userId, role: m.role }))} /> : null}
    >
      {detail.team.length ? (
        <SimpleTable label="Team members" headers={[{ label: "Name" }, { label: "Role" }, { label: "Open tasks", align: "right" }]}>
          {detail.team.map((m) => (
            <tr key={m.userId}>
              <td className={td}>{m.name}</td>
              <td className={td}>
                <Badge tone={teamTone(m.role)}>{TEAM_ROLE_LABELS[m.role]}</Badge>
              </td>
              <td className={`${td} text-right tabular`}>{detail.tasks.filter((t) => t.assigneeId === m.userId && TASK_OPEN.includes(t.status)).length}</td>
            </tr>
          ))}
        </SimpleTable>
      ) : (
        <EmptyState icon={<Users />} title="No team members" />
      )}
    </Panel>
  );
}

async function ActivityTab({ ctx }: { ctx: Ctx }) {
  const e = ctx.detail.engagement;
  const db = getDb();
  const [items, history] = await Promise.all([listEntityTimeline(db, ctx.actor, "engagement", e.id), listStatusHistory(db, ctx.actor, "engagement", e.id)]);
  const label = (s: string) => STATUS_LABELS[s as keyof typeof STATUS_LABELS] ?? s;
  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_24rem]">
      <Panel title="Activity" flush>
        <ClientTimeline items={items} staffNames={ctx.staffNames} emptyText="No activity yet." />
      </Panel>
      <Panel title="Status history" flush>
        {history.length ? (
          <SimpleTable label="Status history" headers={[{ label: "Change" }, { label: "By", hideBelow: "sm" }, { label: "When", align: "right" }]}>
            {history.map((h) => (
              <tr key={h.id}>
                <td className={td}>
                  {h.oldStatus ? <span className="text-muted">{label(h.oldStatus)} → </span> : null}
                  <span className="font-medium">{label(h.newStatus)}</span>
                  {h.note ? <div className="text-[12px] text-muted">{h.note}</div> : null}
                </td>
                <td className={`${td} ${tdHide.sm} text-muted`}>{h.changedByName ?? "System"}</td>
                <td className={`${td} whitespace-nowrap text-right text-[12px] text-muted`}>{formatDate(h.createdAt.toISOString().slice(0, 10))}</td>
              </tr>
            ))}
          </SimpleTable>
        ) : (
          <EmptyState title="No status changes yet" />
        )}
      </Panel>
    </div>
  );
}

async function BillingTab({ ctx }: { ctx: Ctx }) {
  const e = ctx.detail.engagement;
  const rows = await getDb()
    .select({ id: invoices.id, title: invoices.title, number: invoices.qboInvoiceNumber, status: invoices.status, totalCents: invoices.totalCents, currency: invoices.currency, dueDate: invoices.dueDate })
    .from(invoices)
    .where(and(inFirm(invoices.firmId, ctx.actor), eq(invoices.engagementId, e.id)))
    .orderBy(desc(invoices.createdAt));
  const invoiced = rows.filter((r) => r.status !== "cancelled" && r.status !== "draft").reduce((s, r) => s + r.totalCents, 0);
  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_22rem]">
      <Panel
        title="Invoices for this engagement"
        flush
        actions={
          <ButtonLink href={`/staff/clients/${e.clientId}?tab=billing`} variant="secondary" size="sm">
            <Receipt /> Client billing
          </ButtonLink>
        }
      >
        {rows.length ? (
          <SimpleTable label="Invoices" headers={[{ label: "Invoice" }, { label: "Amount", align: "right" }, { label: "Due", hideBelow: "sm" }, { label: "Status" }]}>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className={td}>
                  <div className="font-medium text-ink">{r.title}</div>
                  {r.number ? <div className="text-[12px] text-muted">#{r.number}</div> : null}
                </td>
                <td className={`${td} text-right tabular`}>{formatMoney(r.totalCents, r.currency)}</td>
                <td className={`${td} ${tdHide.sm}`}>{formatDate(r.dueDate)}</td>
                <td className={td}>
                  <Badge tone={INVOICE_TONE[r.status]} dot>{INVOICE_STATUS_LABELS[r.status]}</Badge>
                </td>
              </tr>
            ))}
          </SimpleTable>
        ) : (
          <EmptyState icon={<Briefcase />} title="No invoices linked to this engagement">
            Create invoices on the client’s Billing tab and choose this engagement.
          </EmptyState>
        )}
      </Panel>
      <Panel title="Fee arrangement">
        <DescriptionList
          columns={1}
          items={[
            ["Fee", e.feeCents !== null ? formatMoney(e.feeCents) : "Not set"],
            ["Billing", e.billingFrequency ? BILLING_FREQUENCY_LABELS[e.billingFrequency] : "Not set"],
            ["Invoiced so far", formatMoney(invoiced)],
          ]}
        />
      </Panel>
    </div>
  );
}
