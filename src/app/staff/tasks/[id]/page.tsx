import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CalendarClock, FileText, Lock, MessageSquare, Paperclip, StickyNote, UserCheck } from "lucide-react";
import { getDb } from "@/db";
import { attachTaskFileAction } from "@/app/actions/tasks";
import { UploadForm } from "@/components/documents";
import { SimpleTable, td } from "@/components/table";
import { Alert, Badge, EmptyState, Panel, cx } from "@/components/ui";
import { isManagerOrAdmin } from "@/lib/auth/actor";
import { requireStaffActor } from "@/lib/auth/current";
import { can } from "@/lib/auth/permissions";
import { formatBytes, formatDate, PRIORITY_LABELS, recordNumber, TASK_STATUS_LABELS } from "@/lib/labels";
import { orNotFound } from "@/lib/page-helpers";
import { dueLabel, PRIORITY_TONE, TASK_TONE } from "@/lib/status";
import { firmToday } from "@/services/dashboard";
import { listStaff } from "@/services/engagements";
import { getTask, listTasks } from "@/services/tasks";
import type { TimelineItem } from "@/services/timeline";
import { EditTaskButton } from "../task-ui";
import { AddSubtaskButton, ArchiveTaskButton, AssignButton, Checklist, CommentForm, StatusMenu } from "./task-controls";

export const metadata: Metadata = { title: "Task" };

const timeFmt = new Intl.DateTimeFormat("en-US", { timeZone: process.env.FIRM_TIMEZONE || "America/New_York", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
const hours = (m: number | null) => (m === null ? "—" : `${Math.round((m / 60) * 100) / 100} h`);
const statusLabel = (s: unknown) => (typeof s === "string" && s in TASK_STATUS_LABELS ? TASK_STATUS_LABELS[s as keyof typeof TASK_STATUS_LABELS] : String(s ?? "—"));

function TimelineEntry({ item, names }: { item: TimelineItem; names: Map<string, string> }) {
  const meta = (item.metadata ?? {}) as Record<string, unknown>;
  const icon =
    item.type === "comment" ? <MessageSquare /> : item.type === "internal_note" ? <StickyNote /> : item.type === "assignment" ? <UserCheck /> : item.type === "status_change" ? <ArrowRight /> : <CalendarClock />;
  let text: React.ReactNode = item.body;
  if (item.type === "status_change") {
    text = (
      <>
        Status {meta.from ? <>{statusLabel(meta.from)} → </> : "set to "}
        <span className="font-medium text-ink">{statusLabel(meta.to)}</span>
        {item.body ? <span className="text-muted"> — {item.body}</span> : null}
      </>
    );
  } else if (item.type === "assignment") {
    const who = typeof meta.userId === "string" ? (names.get(meta.userId) ?? "a former staff member") : "someone";
    text = (
      <>
        Assigned to <span className="font-medium text-ink">{who}</span>
      </>
    );
  }
  return (
    <li className="flex gap-3 py-2.5">
      <span className={cx("mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border [&_svg]:size-3", item.type === "internal_note" ? "border-warning/40 bg-warning-soft text-warning-ink" : "border-line bg-subtle text-muted")} aria-hidden>
        {icon}
      </span>
      <div className="min-w-0 flex-1 text-[13px]">
        <p className="text-[12px] text-muted">
          <span className="font-medium text-ink">{item.actorName ?? "System"}</span>
          {item.type === "comment" ? " commented" : item.type === "internal_note" ? " added an internal note" : ""} · {timeFmt.format(item.occurredAt)}
        </p>
        <div className={cx("mt-0.5 whitespace-pre-wrap break-words text-ink", item.type === "internal_note" && "rounded-md bg-warning-soft/50 px-2 py-1")}>{text}</div>
      </div>
    </li>
  );
}

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireStaffActor();
  const { id } = await params;
  const db = getDb();
  const today = firmToday();
  const d = await orNotFound(getTask(db, actor, id));
  const t = d.task;
  const [staff, siblings] = await Promise.all([
    listStaff(db, actor),
    t.engagementId
      ? listTasks(db, actor, { engagementId: t.engagementId, status: "all", today })
      : t.clientId
        ? listTasks(db, actor, { clientId: t.clientId, status: "all", today }).then((r) => r.filter((x) => !x.engagementId))
        : Promise.resolve([]),
  ]);
  const names = new Map(staff.map((s) => [s.id, s.name]));
  const allStaff = staff.map((s) => ({ id: s.id, name: s.name }));
  const canEdit = can(actor, "tasks", "edit");
  const canAssign = can(actor, "tasks", "assign");
  // Without the assign permission, people can only assign work to themselves.
  const staffOptions = canAssign ? allStaff : allStaff.filter((s) => s.id === actor.userId);
  const mayReassign = canEdit && !t.isClientTask && (isManagerOrAdmin(actor) || !t.assigneeId || t.assigneeId === actor.userId);
  const open = t.status !== "completed" && t.status !== "cancelled";
  const due = t.dueDate && open ? dueLabel(t.dueDate, today) : null;
  const siblingOptions = siblings.filter((s) => s.id !== t.id).map((s) => ({ id: s.id, title: s.title }));

  const details: [string, React.ReactNode][] = [
    ["Client", d.clientName && t.clientId ? <Link key="c" href={`/staff/clients/${t.clientId}`} className="text-brand-ink hover:underline">{d.clientName}</Link> : "—"],
    ["Engagement", d.engagementTitle && t.engagementId ? <Link key="e" href={`/staff/engagements/${t.engagementId}`} className="text-brand-ink hover:underline">{d.engagementTitle}</Link> : "—"],
    [
      "Assigned to",
      <span key="a" className="flex flex-wrap items-center gap-2">
        {t.isClientTask ? <Badge tone="warn">Client request</Badge> : <span>{d.assigneeName ?? "Unassigned"}</span>}
        {mayReassign ? <AssignButton taskId={t.id} assigneeId={t.assigneeId} staff={staffOptions} /> : null}
      </span>,
    ],
    ["Assigned by", d.assignedByName ?? "—"],
    ["Start date", formatDate(t.startDate)],
    [
      "Due date",
      <span key="d" className="flex items-center gap-2">
        <span className="tabular">{formatDate(t.dueDate)}</span>
        {due ? <Badge tone={due.tone}>{due.text}</Badge> : null}
      </span>,
    ],
    ["Estimated", hours(t.estimatedMinutes)],
    ["Actual", hours(t.actualMinutes)],
    ["Completed", t.completedAt ? timeFmt.format(t.completedAt) : "—"],
  ];

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-line bg-surface p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-[12px] text-muted">
              <Link href="/staff/tasks" className="hover:text-ink hover:underline">
                Tasks
              </Link>
              {t.taskNumber ? <span className="tabular"> · {recordNumber("T", t.taskNumber)}</span> : null}
              {d.parent ? (
                <>
                  {" · Subtask of "}
                  <Link href={`/staff/tasks/${d.parent.id}`} className="hover:text-ink hover:underline">
                    {d.parent.title}
                  </Link>
                </>
              ) : null}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h1 className="text-[18px] font-semibold leading-7 text-ink">{t.title}</h1>
              <Badge tone={TASK_TONE[t.status]} dot>
                {TASK_STATUS_LABELS[t.status]}
              </Badge>
              <Badge tone={PRIORITY_TONE[t.priority]}>{PRIORITY_LABELS[t.priority]}</Badge>
            </div>
          </div>
          {canEdit ? (
            <div className="flex flex-wrap gap-2">
              <StatusMenu taskId={t.id} status={t.status} />
              <EditTaskButton
                taskId={t.id}
                initial={{
                  title: t.title,
                  description: t.description,
                  isClientTask: t.isClientTask,
                  assigneeId: t.assigneeId,
                  priority: t.priority,
                  startDate: t.startDate,
                  dueDate: t.dueDate,
                  estimatedMinutes: t.estimatedMinutes,
                  actualMinutes: t.actualMinutes,
                  dependsOn: d.dependencies.map((x) => x.id),
                }}
                staff={staffOptions}
                siblings={siblingOptions}
                canAssign={mayReassign}
              />
              {can(actor, "tasks", "delete") ? <ArchiveTaskButton taskId={t.id} title={t.title} /> : null}
            </div>
          ) : null}
        </div>
      </div>

      {d.blockedBy.length && open ? (
        <Alert tone="warning" title="Waiting on other work">
          This task can’t start or be completed until these are done:{" "}
          {d.blockedBy.map((b, i) => (
            <span key={b.id}>
              {i ? ", " : ""}
              <Link href={`/staff/tasks/${b.id}`} className="font-medium underline">
                {b.title}
              </Link>
            </span>
          ))}
          .
        </Alert>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[1fr_22rem]">
        <div className="space-y-5">
          <Panel title="Description">
            {t.description ? <p className="whitespace-pre-wrap text-[13px] text-ink">{t.description}</p> : <p className="text-[13px] text-muted">No description.</p>}
          </Panel>

          <Panel title="Checklist">
            <Checklist taskId={t.id} items={d.checklist.map((c) => ({ id: c.id, title: c.title, done: c.done }))} canEdit={canEdit} />
          </Panel>

          <Panel
            title="Subtasks"
            flush
            actions={canEdit && !t.parentTaskId ? <AddSubtaskButton parentId={t.id} engagementId={t.engagementId} staff={staffOptions} canAssign /> : undefined}
          >
            {d.subtasks.length ? (
              <SimpleTable label="Subtasks" headers={[{ label: "Subtask" }, { label: "Status" }, { label: "Assigned to", hideBelow: "sm" }, { label: "Due", align: "right" }]}>
                {d.subtasks.map((s) => (
                  <tr key={s.id}>
                    <td className={td}>
                      <Link href={`/staff/tasks/${s.id}`} className="font-medium text-ink hover:text-brand hover:underline">
                        {s.title}
                      </Link>
                    </td>
                    <td className={td}>
                      <Badge tone={TASK_TONE[s.status]} dot>
                        {TASK_STATUS_LABELS[s.status]}
                      </Badge>
                    </td>
                    <td className={`${td} hidden text-muted sm:table-cell`}>{s.assigneeName ?? "Unassigned"}</td>
                    <td className={`${td} text-right tabular text-muted`}>{formatDate(s.dueDate)}</td>
                  </tr>
                ))}
              </SimpleTable>
            ) : (
              <p className="px-4 py-3 text-[13px] text-muted">{t.parentTaskId ? "Subtasks can’t have their own subtasks." : "No subtasks."}</p>
            )}
          </Panel>

          <Panel title="Comments & internal notes">
            {canEdit ? (
              <div className="mb-4 grid gap-3 lg:grid-cols-2">
                <CommentForm taskId={t.id} kind="comment" />
                <CommentForm taskId={t.id} kind="internal_note" />
              </div>
            ) : null}
            {d.timeline.length ? (
              <ol className="divide-y divide-line" aria-label="Task activity">
                {d.timeline.map((item) => (
                  <TimelineEntry key={item.id} item={item} names={names} />
                ))}
              </ol>
            ) : (
              <EmptyState title="No activity yet" />
            )}
          </Panel>
        </div>

        <div className="space-y-5">
          <Panel title="Details">
            <dl className="space-y-2.5 text-[13px]">
              {details.map(([k, v]) => (
                <div key={k} className="flex items-start justify-between gap-3">
                  <dt className="shrink-0 text-muted">{k}</dt>
                  <dd className="min-w-0 text-right text-ink">{v}</dd>
                </div>
              ))}
            </dl>
          </Panel>

          <Panel title="Dependencies" description="This task can’t start until these are completed.">
            {d.dependencies.length ? (
              <ul className="space-y-1.5 text-[13px]">
                {d.dependencies.map((dep) => (
                  <li key={dep.id} className="flex items-center justify-between gap-2">
                    <Link href={`/staff/tasks/${dep.id}`} className="min-w-0 truncate text-ink hover:text-brand hover:underline">
                      {dep.title}
                    </Link>
                    <Badge tone={TASK_TONE[dep.status]}>{TASK_STATUS_LABELS[dep.status]}</Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-muted">None. {canEdit && siblingOptions.length ? "Add them with Edit." : ""}</p>
            )}
          </Panel>

          <Panel title="Attachments">
            {d.attachments.length ? (
              <ul className="mb-3 space-y-1.5 text-[13px]">
                {d.attachments.map((a) => (
                  <li key={a.id} className="flex items-center gap-2">
                    <FileText className="size-4 shrink-0 text-muted" aria-hidden />
                    <a href={`/api/documents/${a.id}`} className="min-w-0 flex-1 truncate text-brand-ink hover:underline">
                      {a.fileName}
                    </a>
                    <span className="shrink-0 text-[12px] text-muted">{formatBytes(a.sizeBytes)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mb-3 text-[13px] text-muted">No files attached.</p>
            )}
            {canEdit && t.clientId ? (
              <UploadForm action={attachTaskFileAction.bind(null, t.id)} label="Attach a file" compact />
            ) : !t.clientId ? (
              <p className="flex items-center gap-1.5 text-[12px] text-muted">
                <Paperclip className="size-3.5" aria-hidden /> Attachments need a task that belongs to a client.
              </p>
            ) : null}
            <p className="mt-2 flex items-center gap-1.5 text-[12px] text-muted">
              <Lock className="size-3.5" aria-hidden /> Files are stored with the client’s documents and aren’t shared with the client.
            </p>
          </Panel>

          <Panel title="Status history" flush>
            {d.history.length ? (
              <SimpleTable label="Status history" headers={[{ label: "Change" }, { label: "By", hideBelow: "sm" }, { label: "When", align: "right" }]}>
                {d.history.map((h) => (
                  <tr key={h.id}>
                    <td className={td}>
                      {h.oldStatus ? `${statusLabel(h.oldStatus)} → ` : ""}
                      <span className="font-medium">{statusLabel(h.newStatus)}</span>
                    </td>
                    <td className={`${td} hidden text-muted sm:table-cell`}>{h.changedByName ?? "System"}</td>
                    <td className={`${td} whitespace-nowrap text-right text-[12px] text-muted`}>{timeFmt.format(h.createdAt)}</td>
                  </tr>
                ))}
              </SimpleTable>
            ) : (
              <p className="px-4 py-3 text-[13px] text-muted">No changes yet.</p>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
