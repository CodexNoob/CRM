"use client";

import { useRouter } from "next/navigation";
import { CircleCheck, Play, RotateCcw, SquareCheckBig } from "lucide-react";
import { bulkTaskStatusAction } from "@/app/actions/bulk";
import { CellTitle, DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui";
import type { Priority, TaskStatus } from "@/db/schema";
import { formatDate, PRIORITY_LABELS, recordNumber, TASK_STATUS_LABELS } from "@/lib/labels";
import { dueLabel, PRIORITY_TONE, TASK_TONE } from "@/lib/status";
import { taskMenuItems, useTaskActions, type TaskPerms } from "./task-ui";

/** Serializable task row for the client (dates as ISO strings). */
export interface TaskRowData {
  id: string;
  taskNumber: number | null;
  title: string;
  status: TaskStatus;
  priority: Priority;
  isClientTask: boolean;
  dueDate: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  engagementId: string | null;
  engagementTitle: string | null;
  clientId: string | null;
  clientName: string | null;
}

const PRIORITY_RANK: Record<Priority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
const isOpen = (s: TaskStatus) => s !== "completed" && s !== "cancelled";

export function DueCell({ dueDate, status, today }: { dueDate: string | null; status: TaskStatus; today: string }) {
  if (!dueDate) return <span className="text-muted">—</span>;
  if (!isOpen(status)) return <span className="tabular text-muted">{formatDate(dueDate)}</span>;
  const d = dueLabel(dueDate, today);
  return (
    <div className="whitespace-nowrap">
      <div className="tabular text-ink">{formatDate(dueDate)}</div>
      <div className={d.tone === "danger" ? "text-[12px] font-medium text-danger-ink" : d.tone === "warn" ? "text-[12px] text-warning-ink" : "text-[12px] text-muted"}>{d.text}</div>
    </div>
  );
}

export function TasksTable({ rows, today, perms }: { rows: TaskRowData[]; today: string; perms: TaskPerms }) {
  const router = useRouter();
  const actions = useTaskActions();
  const bulk = (status: TaskStatus) => async (ids: string[]) => {
    const r = await bulkTaskStatusAction(ids, status);
    router.refresh();
    return r;
  };
  return (
    <DataTable
      label="Tasks"
      rows={rows}
      getId={(r) => r.id}
      rowHref={(r) => `/crm/tasks/${r.id}`}
      initialSort={{ id: "due", dir: "asc" }}
      search={{ placeholder: "Filter this list", text: (r) => `${r.title} ${recordNumber("T", r.taskNumber) ?? ""} ${r.clientName ?? ""} ${r.engagementTitle ?? ""} ${r.assigneeName ?? ""}` }}
      bulkActions={
        perms.canEdit
          ? [
              { label: "Mark in progress", icon: <Play />, run: bulk("in_progress") },
              { label: "Mark completed", icon: <CircleCheck />, run: bulk("completed") },
              { label: "Reopen", icon: <RotateCcw />, run: bulk("todo") },
            ]
          : undefined
      }
      columns={[
        {
          id: "title",
          header: "Task",
          sort: (r) => r.title.toLowerCase(),
          cell: (r) => (
            <CellTitle
              title={
                <span>
                  {r.taskNumber ? <span className="mr-1.5 tabular text-[12px] font-normal text-muted">{recordNumber("T", r.taskNumber)}</span> : null}
                  {r.title}
                </span>
              }
              sub={[r.engagementTitle, r.clientName].filter(Boolean).join(" · ") || "Internal task"}
              href={`/crm/tasks/${r.id}`}
            />
          ),
        },
        { id: "status", header: "Status", sort: (r) => r.status, cell: (r) => <Badge tone={TASK_TONE[r.status]} dot>{TASK_STATUS_LABELS[r.status]}</Badge> },
        { id: "priority", header: "Priority", sort: (r) => PRIORITY_RANK[r.priority], hideBelow: "sm", cell: (r) => <Badge tone={PRIORITY_TONE[r.priority]}>{PRIORITY_LABELS[r.priority]}</Badge> },
        {
          id: "who",
          header: "Assigned to",
          sort: (r) => (r.isClientTask ? "~client" : (r.assigneeName ?? "~")),
          hideBelow: "md",
          cell: (r) => (r.isClientTask ? <Badge tone="warn">Client request</Badge> : <span className="text-muted">{r.assigneeName ?? "Unassigned"}</span>),
        },
        { id: "due", header: "Due", sort: (r) => r.dueDate, cell: (r) => <DueCell dueDate={r.dueDate} status={r.status} today={today} /> },
        { id: "engagement", header: "Engagement", sort: (r) => r.engagementTitle?.toLowerCase(), hideBelow: "lg", cell: (r) => <span className="text-muted">{r.engagementTitle ?? "—"}</span> },
        { id: "client", header: "Client", sort: (r) => r.clientName?.toLowerCase(), hideBelow: "lg", cell: (r) => <span className="text-ink">{r.clientName ?? "—"}</span> },
      ]}
      rowActions={(r) => taskMenuItems(r, actions, perms)}
      empty={{ title: "No tasks match", body: "Change the filters, or create a task. Engagement tasks are added from the engagement or generated from a workflow template.", icon: <SquareCheckBig /> }}
    />
  );
}
