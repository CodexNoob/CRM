"use client";

import Link from "next/link";
import { MoreHorizontal } from "lucide-react";
import { Menu } from "@/components/menu";
import { Badge, cx } from "@/components/ui";
import { formatDate, PRIORITY_LABELS, recordNumber, TASK_STATUS_LABELS } from "@/lib/labels";
import { dueLabel, PRIORITY_TONE, TASK_TONE } from "@/lib/status";
import { BOARD_STATUSES } from "./filters";
import { taskMenuItems, useTaskActions, type TaskPerms } from "./task-ui";
import type { TaskRowData } from "./tasks-table";

/**
 * Kanban board: one column per status. Cards move with a keyboard-accessible
 * "Move to…" menu (no drag-and-drop). The server enforces dependency and
 * proposal-acceptance rules; refusals come back as toasts.
 */
export function TaskBoard({ rows, today, perms }: { rows: TaskRowData[]; today: string; perms: TaskPerms }) {
  const actions = useTaskActions();
  const byStatus = new Map(BOARD_STATUSES.map((s) => [s, [] as TaskRowData[]]));
  for (const r of rows) byStatus.get(r.status)?.push(r);

  return (
    <div className={cx("-mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0", actions.pending && "opacity-70")} aria-busy={actions.pending}>
      <ol className="flex min-w-max gap-3" aria-label="Task board">
        {BOARD_STATUSES.map((status) => {
          const cards = byStatus.get(status) ?? [];
          return (
            <li key={status} className="flex w-64 shrink-0 flex-col rounded-lg border border-line bg-subtle/60">
              <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
                <h3>
                  <Badge tone={TASK_TONE[status]} dot>
                    {TASK_STATUS_LABELS[status]}
                  </Badge>
                </h3>
                <span className="text-[12px] tabular text-muted">{cards.length}</span>
              </div>
              <ul className="flex max-h-[65vh] flex-col gap-2 overflow-y-auto p-2" aria-label={`${TASK_STATUS_LABELS[status]}: ${cards.length} tasks`}>
                {cards.length === 0 ? <li className="px-1 py-3 text-center text-[12px] text-faint">No tasks</li> : null}
                {cards.map((r) => {
                  const due = r.dueDate && status !== "completed" ? dueLabel(r.dueDate, today) : null;
                  return (
                    <li key={r.id} className="rounded-md border border-line bg-surface p-2.5 shadow-sm">
                      <div className="flex items-start justify-between gap-2">
                        <Link href={`/crm/tasks/${r.id}`} className="min-w-0 text-[13px] font-medium text-ink hover:text-brand hover:underline">
                          <span className="block">{r.title}</span>
                          <span className="block truncate text-[12px] font-normal text-muted">{[r.engagementTitle, r.clientName].filter(Boolean).join(" · ") || "Internal task"}</span>
                        </Link>
                        <Menu
                          label={`Actions for ${r.title}`}
                          trigger={<MoreHorizontal className="size-4" />}
                          triggerClassName="-mr-1 -mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted hover:bg-subtle hover:text-ink"
                          items={taskMenuItems(r, actions, perms)}
                        />
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
                        {r.taskNumber ? <span className="tabular">{recordNumber("T", r.taskNumber)}</span> : null}
                        {r.priority !== "normal" ? <Badge tone={PRIORITY_TONE[r.priority]}>{PRIORITY_LABELS[r.priority]}</Badge> : null}
                        {r.isClientTask ? <Badge tone="warn">Client</Badge> : null}
                      </div>
                      <div className="mt-1.5 flex items-center justify-between gap-2 text-[12px]">
                        <span className="truncate text-muted">{r.isClientTask ? "Client request" : (r.assigneeName ?? "Unassigned")}</span>
                        {r.dueDate ? (
                          <span className={cx("shrink-0 tabular", due?.tone === "danger" ? "font-medium text-danger-ink" : "text-muted")}>
                            {due?.tone === "danger" ? "Overdue " : ""}
                            {formatDate(r.dueDate)}
                          </span>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
