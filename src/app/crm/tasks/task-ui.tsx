"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArrowRight, Briefcase, Plus, UserMinus, UserPlus, Users } from "lucide-react";
import { archiveTaskAction, assignTaskAction, createTaskAction, setTaskStatusAction, updateTaskAction } from "@/app/actions/tasks";
import { Dialog } from "@/components/dialog";
import { FormMessage, SelectField, SubmitButton, TextField, textareaClass } from "@/components/form";
import type { MenuItem } from "@/components/menu";
import { useToast } from "@/components/toast";
import { buttonClass } from "@/components/ui";
import type { Priority, TaskStatus } from "@/db/schema";
import { idleState, type ActionState } from "@/lib/action-state";
import { PRIORITY_LABELS, TASK_STATUS_LABELS } from "@/lib/labels";
import { PRIORITIES, TASK_STATUSES } from "./filters";

/** What a task row/card needs for its menu. */
export interface TaskMenuRow {
  id: string;
  title: string;
  status: TaskStatus;
  isClientTask: boolean;
  assigneeId: string | null;
  engagementId: string | null;
  clientId: string | null;
}

export interface TaskPerms {
  canEdit: boolean;
  canAssign: boolean;
  canDelete: boolean;
  /** Admins/managers may reassign anyone's task; employees only their own or unassigned ones. */
  isManager: boolean;
  userId: string;
}

/** Status moves, assignment and archiving with toasts + refresh. */
export function useTaskActions() {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<ActionState>) =>
    start(async () => {
      const r = await fn();
      toast.fromState(r);
      router.refresh();
    });
  return {
    pending,
    move: (id: string, status: TaskStatus) => run(() => setTaskStatusAction(id, status)),
    assign: (id: string, userId: string | null) => run(() => assignTaskAction(id, userId)),
    archive: (r: { id: string; title: string }) => {
      if (window.confirm(`Archive “${r.title}”? It disappears from task lists but keeps its history.`)) run(() => archiveTaskAction(r.id));
    },
  };
}

export function taskMenuItems(r: TaskMenuRow, a: ReturnType<typeof useTaskActions>, p: TaskPerms): MenuItem[] {
  const items: MenuItem[] = [{ label: "Open task", icon: <ArrowRight />, href: `/crm/tasks/${r.id}` }];
  if (p.canEdit) {
    items.push({ type: "separator" }, { type: "label", label: "Set status" });
    for (const s of TASK_STATUSES) {
      if (s !== r.status) items.push({ label: TASK_STATUS_LABELS[s], onSelect: () => a.move(r.id, s) });
    }
    if (!r.isClientTask) {
      const mayReassign = p.isManager || !r.assigneeId || r.assigneeId === p.userId;
      items.push({ type: "separator" });
      if (r.assigneeId !== p.userId && mayReassign) items.push({ label: "Assign to me", icon: <UserPlus />, onSelect: () => a.assign(r.id, p.userId) });
      if (r.assigneeId && mayReassign) items.push({ label: "Unassign", icon: <UserMinus />, onSelect: () => a.assign(r.id, null) });
    }
  }
  if (r.engagementId || r.clientId) items.push({ type: "separator" });
  if (r.engagementId) items.push({ label: "Open engagement", icon: <Briefcase />, href: `/crm/engagements/${r.engagementId}` });
  if (r.clientId) items.push({ label: "Open client", icon: <Users />, href: `/crm/clients/${r.clientId}` });
  if (p.canDelete) items.push({ type: "separator" }, { label: "Archive task", icon: <Archive />, danger: true, onSelect: () => a.archive(r) });
  return items;
}

/* ───────── Task form (create / edit / subtask) ───────── */

export interface TaskFormValues {
  title?: string;
  description?: string | null;
  isClientTask?: boolean;
  assigneeId?: string | null;
  priority?: Priority;
  startDate?: string | null;
  dueDate?: string | null;
  estimatedMinutes?: number | null;
  actualMinutes?: number | null;
  clientId?: string | null;
  dependsOn?: string[];
}

const hours = (m: number | null | undefined) => (m === null || m === undefined ? "" : String(Math.round((m / 60) * 100) / 100));

/** All task fields. `clients` shows the client picker (standalone tasks); `siblings` shows dependency checkboxes. */
export function TaskFields({
  state,
  initial = {},
  staff,
  clients,
  siblings,
  canAssign,
  showActual,
}: {
  state: ActionState;
  initial?: TaskFormValues;
  staff: { id: string; name: string }[];
  clients?: { id: string; name: string }[];
  siblings?: { id: string; title: string }[];
  canAssign: boolean;
  showActual?: boolean;
}) {
  const v = (k: string, fallback: string | null | undefined) => state.values?.[k] ?? fallback ?? "";
  const [clientTask, setClientTask] = useState(state.values ? state.values.isClientTask === "on" : !!initial.isClientTask);
  const deps = new Set(initial.dependsOn ?? []);
  return (
    <div className="space-y-3">
      <TextField name="title" label="Task" required state={state} defaultValue={v("title", initial.title)} />
      <div className="space-y-1.5">
        <label htmlFor="description" className="block text-[12.5px] font-medium text-ink">
          Description
        </label>
        <textarea id="description" name="description" rows={3} maxLength={5000} defaultValue={v("description", initial.description)} className={textareaClass} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {clients ? <SelectField name="clientId" label="Client (optional)" state={state} defaultValue={v("clientId", initial.clientId)} placeholder="No client (internal)" options={clients.map((c) => ({ value: c.id, label: c.name }))} /> : null}
        <SelectField name="priority" label="Priority" state={state} defaultValue={v("priority", initial.priority ?? "normal")} options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] }))} />
        {canAssign && !clientTask ? (
          <SelectField name="assigneeId" label="Assigned to" state={state} defaultValue={v("assigneeId", initial.assigneeId)} placeholder="Unassigned" options={staff.map((s) => ({ value: s.id, label: s.name }))} />
        ) : !clientTask && initial.assigneeId ? (
          <input type="hidden" name="assigneeId" value={initial.assigneeId} />
        ) : null}
        <TextField name="startDate" label="Start date" type="date" state={state} defaultValue={v("startDate", initial.startDate)} />
        <TextField name="dueDate" label="Due date" type="date" state={state} defaultValue={v("dueDate", initial.dueDate)} />
        <TextField name="estimatedMinutes" label="Estimated hours" inputMode="text" state={state} defaultValue={v("estimatedMinutes", hours(initial.estimatedMinutes))} placeholder="e.g. 1.5" />
        {showActual ? <TextField name="actualMinutes" label="Actual hours" inputMode="text" state={state} defaultValue={v("actualMinutes", hours(initial.actualMinutes))} placeholder="e.g. 2" /> : null}
      </div>
      <label className="flex items-start gap-2 text-[13px] text-ink">
        <input type="checkbox" name="isClientTask" className="mt-0.5 size-4 accent-brand" checked={clientTask} onChange={(e) => setClientTask(e.target.checked)} />
        <span>
          Client request — shown in the client’s portal for them to complete
          {state.fieldErrors?.isClientTask ? <span className="block text-xs text-danger-ink">{state.fieldErrors.isClientTask.join(" ")}</span> : null}
        </span>
      </label>
      {siblings && siblings.length ? (
        <fieldset className="space-y-1.5">
          <legend className="text-[12.5px] font-medium text-ink">Can’t start until these are completed</legend>
          <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-line p-2">
            {siblings.map((s) => (
              <label key={s.id} className="flex items-center gap-2 text-[13px]">
                <input type="checkbox" name="dependsOn" value={s.id} defaultChecked={deps.has(s.id)} className="size-4 accent-brand" />
                <span className="truncate">{s.title}</span>
              </label>
            ))}
          </div>
          {state.fieldErrors?.dependsOn ? <p className="text-[12px] text-danger-ink">{state.fieldErrors.dependsOn.join(" ")}</p> : null}
        </fieldset>
      ) : null}
    </div>
  );
}

/** "New task" button + dialog for standalone tasks (client optional). Redirects to the new task. */
export function NewTaskButton({ staff, clients, canAssign }: { staff: { id: string; name: string }[]; clients: { id: string; name: string }[]; canAssign: boolean }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(createTaskAction, idleState);
  return (
    <>
      <button type="button" className={buttonClass("primary")} onClick={() => setOpen(true)}>
        <Plus /> New task
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="New task" description="For engagement work, add tasks from the engagement so they’re linked to it." size="lg">
        <form action={action} className="space-y-4" noValidate>
          <FormMessage state={state} />
          <TaskFields state={state} staff={staff} clients={clients} canAssign={canAssign} />
          <div className="flex justify-end gap-2 border-t border-line pt-3">
            <button type="button" className={buttonClass("secondary")} onClick={() => setOpen(false)}>
              Cancel
            </button>
            <SubmitButton pendingText="Creating…">Create task</SubmitButton>
          </div>
        </form>
      </Dialog>
    </>
  );
}

/** Edit dialog on the task page. */
export function EditTaskButton({
  taskId,
  initial,
  staff,
  siblings,
  canAssign,
}: {
  taskId: string;
  initial: TaskFormValues;
  staff: { id: string; name: string }[];
  siblings: { id: string; title: string }[];
  canAssign: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  return (
    <>
      <button
        type="button"
        className={buttonClass("secondary")}
        onClick={() => {
          setFormKey((k) => k + 1);
          setOpen(true);
        }}
      >
        Edit
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Edit task" size="lg">
        <EditTaskForm key={formKey} taskId={taskId} initial={initial} staff={staff} siblings={siblings} canAssign={canAssign} onDone={() => setOpen(false)} />
      </Dialog>
    </>
  );
}

function EditTaskForm({ taskId, initial, staff, siblings, canAssign, onDone }: { taskId: string; initial: TaskFormValues; staff: { id: string; name: string }[]; siblings: { id: string; title: string }[]; canAssign: boolean; onDone: () => void }) {
  const [state, action] = useActionState(updateTaskAction.bind(null, taskId), idleState);
  const toast = useToast();
  const router = useRouter();
  useEffect(() => {
    if (state.status === "success") {
      toast.fromState(state);
      router.refresh();
      onDone();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  return (
    <form action={action} className="space-y-4" noValidate>
      {state.status === "error" ? <FormMessage state={state} /> : null}
      <TaskFields state={state.status === "success" ? idleState : state} initial={initial} staff={staff} siblings={siblings} canAssign={canAssign} showActual />
      <div className="flex justify-end gap-2 border-t border-line pt-3">
        <button type="button" className={buttonClass("secondary")} onClick={onDone}>
          Cancel
        </button>
        <SubmitButton pendingText="Saving…">Save task</SubmitButton>
      </div>
    </form>
  );
}
