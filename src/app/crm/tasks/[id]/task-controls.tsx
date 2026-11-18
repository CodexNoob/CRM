"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Plus, Trash2 } from "lucide-react";
import {
  addChecklistItemAction,
  addTaskCommentAction,
  archiveTaskAction,
  assignTaskFormAction,
  createSubtaskAction,
  removeChecklistItemAction,
  setChecklistItemAction,
  setTaskStatusAction,
} from "@/app/actions/tasks";
import { Dialog } from "@/components/dialog";
import { FormMessage, SelectField, SubmitButton, textareaClass } from "@/components/form";
import { Menu } from "@/components/menu";
import { useToast } from "@/components/toast";
import { buttonClass, cx } from "@/components/ui";
import type { TaskStatus } from "@/db/schema";
import { idleState, type ActionState } from "@/lib/action-state";
import { TASK_STATUS_LABELS } from "@/lib/labels";
import { TASK_STATUSES } from "../filters";
import { TaskFields } from "../task-ui";

/** Runs a server action, shows a toast and refreshes. */
function useRun() {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  return {
    pending,
    run: (fn: () => Promise<ActionState>, quiet = false) =>
      start(async () => {
        const r = await fn();
        if (!quiet || r.status === "error") toast.fromState(r);
        router.refresh();
      }),
  };
}

/** Calls onSuccess once per successful form submission (toast + refresh). */
function useFormResult(state: ActionState, onSuccess?: () => void) {
  const router = useRouter();
  const toast = useToast();
  const seen = useRef<ActionState | null>(null);
  useEffect(() => {
    if (state === seen.current || state.status === "idle") return;
    seen.current = state;
    if (state.status === "success") {
      toast.fromState(state);
      router.refresh();
      onSuccess?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
}

export function StatusMenu({ taskId, status }: { taskId: string; status: TaskStatus }) {
  const { pending, run } = useRun();
  return (
    <Menu
      label="Change status"
      triggerClassName={buttonClass("secondary", pending ? "opacity-70" : undefined)}
      trigger={
        <>
          {TASK_STATUS_LABELS[status]} <ChevronDown className="size-3.5" />
        </>
      }
      items={[{ type: "label", label: "Move to" }, ...TASK_STATUSES.filter((s) => s !== status).map((s) => ({ label: TASK_STATUS_LABELS[s], onSelect: () => run(() => setTaskStatusAction(taskId, s)) }))]}
    />
  );
}

export function ArchiveTaskButton({ taskId, title }: { taskId: string; title: string }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      className={buttonClass("ghost", "text-danger-ink")}
      onClick={() => {
        if (!window.confirm(`Archive “${title}”? It disappears from task lists but keeps its history.`)) return;
        start(async () => {
          const r = await archiveTaskAction(taskId);
          toast.fromState(r);
          if (r.status === "success") router.push("/crm/tasks");
        });
      }}
    >
      Archive
    </button>
  );
}

export function AssignButton({ taskId, assigneeId, staff }: { taskId: string; assigneeId: string | null; staff: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(0);
  return (
    <>
      <button
        type="button"
        className="text-[12.5px] font-medium text-brand-ink hover:underline"
        onClick={() => {
          setKey((k) => k + 1);
          setOpen(true);
        }}
      >
        {assigneeId ? "Reassign" : "Assign"}
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Assign task" size="sm">
        <AssignForm key={key} taskId={taskId} assigneeId={assigneeId} staff={staff} onDone={() => setOpen(false)} />
      </Dialog>
    </>
  );
}

function AssignForm({ taskId, assigneeId, staff, onDone }: { taskId: string; assigneeId: string | null; staff: { id: string; name: string }[]; onDone: () => void }) {
  const [state, action] = useActionState(assignTaskFormAction.bind(null, taskId), idleState);
  useFormResult(state, onDone);
  return (
    <form action={action} className="space-y-3">
      {state.status === "error" ? <FormMessage state={state} /> : null}
      <SelectField name="assigneeId" label="Assigned to" state={idleState} defaultValue={assigneeId} placeholder="Unassigned" options={staff.map((s) => ({ value: s.id, label: s.name }))} />
      <div className="flex justify-end gap-2">
        <button type="button" className={buttonClass("secondary")} onClick={onDone}>
          Cancel
        </button>
        <SubmitButton pendingText="Saving…">Save</SubmitButton>
      </div>
    </form>
  );
}

export function AddSubtaskButton({ parentId, engagementId, staff, canAssign }: { parentId: string; engagementId: string | null; staff: { id: string; name: string }[]; canAssign: boolean }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(0);
  return (
    <>
      <button
        type="button"
        className={buttonClass("ghost", undefined, "sm")}
        onClick={() => {
          setKey((k) => k + 1);
          setOpen(true);
        }}
      >
        <Plus /> Add subtask
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Add subtask" description="Belongs to the same engagement and client as this task." size="lg">
        <SubtaskForm key={key} parentId={parentId} engagementId={engagementId} staff={staff} canAssign={canAssign} onDone={() => setOpen(false)} />
      </Dialog>
    </>
  );
}

function SubtaskForm({ parentId, engagementId, staff, canAssign, onDone }: { parentId: string; engagementId: string | null; staff: { id: string; name: string }[]; canAssign: boolean; onDone: () => void }) {
  const [state, action] = useActionState(createSubtaskAction.bind(null, parentId, engagementId), idleState);
  useFormResult(state, onDone);
  return (
    <form action={action} className="space-y-4" noValidate>
      {state.status === "error" ? <FormMessage state={state} /> : null}
      <TaskFields state={state.status === "success" ? idleState : state} staff={staff} canAssign={canAssign} />
      <div className="flex justify-end gap-2 border-t border-line pt-3">
        <button type="button" className={buttonClass("secondary")} onClick={onDone}>
          Cancel
        </button>
        <SubmitButton pendingText="Adding…">Add subtask</SubmitButton>
      </div>
    </form>
  );
}

export function Checklist({ taskId, items, canEdit }: { taskId: string; items: { id: string; title: string; done: boolean }[]; canEdit: boolean }) {
  const { pending, run } = useRun();
  const [formKey, setFormKey] = useState(0);
  const [state, action] = useActionState(addChecklistItemAction.bind(null, taskId), idleState);
  useFormResult(state, () => setFormKey((k) => k + 1));
  const done = items.filter((i) => i.done).length;
  return (
    <div className={cx("space-y-3", pending && "opacity-70")}>
      {items.length ? (
        <>
          <div className="flex items-center gap-2 text-[12px] text-muted">
            <span className="tabular">
              {done} of {items.length} done
            </span>
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-subtle" aria-hidden>
              <span className="block h-full bg-success" style={{ width: `${Math.round((done / items.length) * 100)}%` }} />
            </span>
          </div>
          <ul className="divide-y divide-line rounded-md border border-line">
            {items.map((i) => (
              <li key={i.id} className="flex items-center gap-2 px-3 py-2 text-[13px]">
                <input
                  type="checkbox"
                  className="size-4 accent-brand"
                  checked={i.done}
                  disabled={!canEdit || pending}
                  aria-label={`${i.done ? "Uncheck" : "Check"} ${i.title}`}
                  onChange={(e) => run(() => setChecklistItemAction(taskId, i.id, e.target.checked), true)}
                />
                <span className={cx("flex-1", i.done && "text-faint line-through")}>{i.title}</span>
                {canEdit ? (
                  <button
                    type="button"
                    className="rounded p-1 text-muted hover:bg-subtle hover:text-danger-ink"
                    aria-label={`Remove ${i.title}`}
                    onClick={() => {
                      if (window.confirm(`Remove “${i.title}” from the checklist?`)) run(() => removeChecklistItemAction(taskId, i.id));
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="text-[13px] text-muted">No checklist steps yet.</p>
      )}
      {canEdit ? (
        <form key={formKey} action={action} className="flex gap-2">
          <label htmlFor="checklist-title" className="sr-only">
            New checklist step
          </label>
          <input id="checklist-title" name="title" maxLength={300} placeholder="Add a step" className="h-8 min-w-0 flex-1 rounded-md border border-line bg-surface px-2.5 text-[13px]" />
          <SubmitButton pendingText="Adding…" variant="secondary" size="sm">
            Add
          </SubmitButton>
        </form>
      ) : null}
      {state.status === "error" ? <p className="text-[12px] text-danger-ink">{state.fieldErrors?.title?.join(" ") ?? state.message}</p> : null}
    </div>
  );
}

/** Comment or internal-note form. Internal notes are staff-only working notes. */
export function CommentForm({ taskId, kind }: { taskId: string; kind: "comment" | "internal_note" }) {
  const [formKey, setFormKey] = useState(0);
  const [state, action] = useActionState(addTaskCommentAction.bind(null, taskId, kind), idleState);
  useFormResult(state, () => setFormKey((k) => k + 1));
  const id = `body-${kind}`;
  return (
    <form key={formKey} action={action} className={cx("space-y-2 rounded-md border p-3", kind === "internal_note" ? "border-warning/40 bg-warning-soft/50" : "border-line")}>
      <label htmlFor={id} className="block text-[12.5px] font-medium text-ink">
        {kind === "internal_note" ? "Internal note" : "Comment"}
        <span className="ml-1 font-normal text-muted">{kind === "internal_note" ? "— working notes for the team" : "— discussion about this task"}</span>
      </label>
      <textarea id={id} name="body" rows={2} maxLength={5000} required className={textareaClass} placeholder="Don’t include Social Security or account numbers." />
      {state.status === "error" ? <p className="text-[12px] text-danger-ink">{state.fieldErrors?.body?.join(" ") ?? state.message}</p> : null}
      <div className="flex justify-end">
        <SubmitButton pendingText="Saving…" variant="secondary" size="sm">
          {kind === "internal_note" ? "Add note" : "Add comment"}
        </SubmitButton>
      </div>
    </form>
  );
}
