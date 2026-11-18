import type { Metadata } from "next";
import Link from "next/link";
import { Workflow } from "lucide-react";
import { getDb } from "@/db";
import { buttonClass, ButtonLink, PageHeader, SegmentedLinks } from "@/components/ui";
import { isManagerOrAdmin } from "@/lib/auth/actor";
import { requireStaffActor } from "@/lib/auth/current";
import { can } from "@/lib/auth/permissions";
import { PRIORITY_LABELS, TASK_STATUS_LABELS } from "@/lib/labels";
import { listClients } from "@/services/clients";
import { firmToday } from "@/services/dashboard";
import { listStaff } from "@/services/engagements";
import { listTasks } from "@/services/tasks";
import { parseTaskParams, PRIORITIES, TASK_STATUSES, tasksHref, type TaskSearchParams } from "./filters";
import { TaskBoard } from "./task-board";
import { TaskCalendar } from "./task-calendar";
import { NewTaskButton, type TaskPerms } from "./task-ui";
import { TasksTable, type TaskRowData } from "./tasks-table";

export const metadata: Metadata = { title: "Tasks & Workflows" };

const field = "h-8 rounded-md border border-line bg-surface px-2 text-[13px] text-ink";

export default async function TasksPage({ searchParams }: { searchParams: Promise<TaskSearchParams> }) {
  const actor = await requireStaffActor();
  const db = getDb();
  const today = firmToday();
  const p = parseTaskParams(await searchParams, today);
  const [rows, staff, clients] = await Promise.all([listTasks(db, actor, { ...p.filters, ...(p.scope === "client" ? { isClientTask: true } : {}) }), listStaff(db, actor), listClients(db, actor)]);
  const scoped = rows; // client-request scope is filtered in the database
  const data: TaskRowData[] = scoped.map((r) => ({
    id: r.id,
    taskNumber: r.taskNumber,
    title: r.title,
    status: r.status,
    priority: r.priority,
    isClientTask: r.isClientTask,
    dueDate: r.dueDate,
    assigneeId: r.assigneeId,
    assigneeName: r.assigneeName,
    engagementId: r.engagementId,
    engagementTitle: r.engagementTitle,
    clientId: r.clientId,
    clientName: r.clientName,
  }));
  const perms: TaskPerms = {
    canEdit: can(actor, "tasks", "edit"),
    canAssign: can(actor, "tasks", "assign"),
    canDelete: can(actor, "tasks", "delete"),
    isManager: isManagerOrAdmin(actor),
    userId: actor.userId,
  };
  const staffOptions = staff.map((s) => ({ id: s.id, name: s.name }));
  const clientOptions = clients.map((c) => ({ id: c.id, name: c.displayName }));
  const hasFilters = Object.values(p.raw).some(Boolean);

  return (
    <>
      <PageHeader
        title="Tasks & Workflows"
        description="The work across your engagements and clients. Generate engagement tasks from a workflow template on the engagement page."
        actions={
          <div className="flex flex-wrap gap-2">
            {can(actor, "templates", "view") ? (
              <ButtonLink href="/crm/tasks/templates" variant="secondary">
                <Workflow /> Workflow templates
              </ButtonLink>
            ) : null}
            {can(actor, "tasks", "create") ? (
              // Without the assign permission, people can only assign tasks to themselves.
              <NewTaskButton staff={perms.canAssign ? staffOptions : staffOptions.filter((s) => s.id === actor.userId)} clients={clientOptions} canAssign />
            ) : null}
          </div>
        }
      />

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <SegmentedLinks
          label="Whose tasks"
          items={[
            { href: tasksHref(p, { scope: "mine" }), label: "My tasks", active: p.scope === "mine" },
            { href: tasksHref(p, { scope: "team" }), label: "Team tasks", active: p.scope === "team" },
            { href: tasksHref(p, { scope: "client" }), label: "Client requests", active: p.scope === "client" },
          ]}
        />
        <SegmentedLinks
          label="Task view"
          items={[
            { href: tasksHref(p, { view: "list" }), label: "List", active: p.view === "list" },
            { href: tasksHref(p, { view: "board" }), label: "Board", active: p.view === "board" },
            { href: tasksHref(p, { view: "calendar" }), label: "Calendar", active: p.view === "calendar" },
          ]}
        />
      </div>

      <form method="get" action="/crm/tasks" className="mb-4 flex flex-wrap items-end gap-2 rounded-lg border border-line bg-surface p-3" aria-label="Filter tasks">
        {p.view !== "list" ? <input type="hidden" name="view" value={p.view} /> : null}
        {p.scope !== "mine" ? <input type="hidden" name="scope" value={p.scope} /> : null}
        {p.view === "calendar" ? <input type="hidden" name="month" value={p.month} /> : null}
        <label className="flex min-w-48 flex-1 flex-col gap-1 text-[12px] text-muted">
          Search
          <input name="q" defaultValue={p.raw.q} placeholder="Task, client or engagement" className={field} />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-muted">
          Status
          <select name="status" defaultValue={p.raw.status} className={field}>
            <option value="">{p.view === "board" ? "All statuses" : "Open"}</option>
            <option value="done">Completed & cancelled</option>
            <option value="all">All</option>
            {TASK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {TASK_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-muted">
          Assigned to
          <select name="assignee" defaultValue={p.raw.assignee} className={field}>
            <option value="">Anyone</option>
            <option value="none">Unassigned</option>
            {staffOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-muted">
          Priority
          <select name="priority" defaultValue={p.raw.priority} className={field}>
            <option value="">Any</option>
            {PRIORITIES.map((x) => (
              <option key={x} value={x}>
                {PRIORITY_LABELS[x]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-muted">
          Due
          <select name="due" defaultValue={p.raw.due} className={field}>
            <option value="">Any time</option>
            <option value="overdue">Overdue</option>
            <option value="today">Today</option>
            <option value="week">Next 7 days</option>
            <option value="none">No due date</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-muted">
          Client
          <select name="client" defaultValue={p.raw.client} className={`${field} max-w-48`}>
            <option value="">Any client</option>
            {clientOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <div className="flex gap-2">
          <button type="submit" className={buttonClass("secondary", undefined, "sm")}>
            Apply
          </button>
          {hasFilters ? (
            <Link href={tasksHref({ ...p, raw: { q: "", status: "", assignee: "", priority: "", due: "", client: "" } })} className={buttonClass("ghost", undefined, "sm")}>
              Clear
            </Link>
          ) : null}
        </div>
      </form>

      {p.view === "board" ? (
        <TaskBoard rows={data} today={today} perms={perms} />
      ) : p.view === "calendar" ? (
        <TaskCalendar rows={data} month={p.month} today={today} hrefFor={(month) => tasksHref(p, { month })} />
      ) : (
        <TasksTable key={tasksHref(p)} rows={data} today={today} perms={perms} />
      )}
    </>
  );
}
