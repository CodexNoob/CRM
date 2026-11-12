"use client";

import { useActionState, useEffect, useRef } from "react";
import { Check } from "lucide-react";
import { createTaskAction, setTaskStatusAction } from "@/app/actions/staff";
import { FormMessage, SelectField, SubmitButton, TextField } from "@/components/form";
import { idleState } from "@/lib/action-state";

export function TaskToggle({ taskId, done, title }: { taskId: string; done: boolean; title: string }) {
  const [state, action, pending] = useActionState(setTaskStatusAction.bind(null, taskId, done ? "open" : "done"), idleState);
  return (
    <form action={action} className="flex">
      <button
        type="submit"
        disabled={pending}
        aria-label={done ? `Reopen “${title}”` : `Mark “${title}” done`}
        aria-pressed={done}
        className={
          "flex size-4.5 items-center justify-center rounded border transition-colors disabled:opacity-50 " +
          (done ? "border-success bg-success text-white" : "border-line-strong bg-surface hover:border-brand")
        }
      >
        {done ? <Check className="size-3" strokeWidth={3} aria-hidden /> : null}
      </button>
      {state.status === "error" ? (
        <span role="alert" className="sr-only">
          {state.message}
        </span>
      ) : null}
    </form>
  );
}

export function TaskForm({ engagementId, staff }: { engagementId: string; staff: { id: string; name: string }[] }) {
  const [state, action] = useActionState(createTaskAction.bind(null, engagementId), idleState);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.status === "success") formRef.current?.reset();
  }, [state]);
  const formState = state.status === "success" ? { ...state, values: undefined } : state;

  return (
    <form ref={formRef} action={action} className="space-y-4" noValidate>
      <FormMessage state={state} />
      <TextField name="title" label="Task" required state={formState} placeholder="e.g. Upload your 2026 W-2 forms" />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          name="assigneeId"
          label="Assign to staff"
          state={formState}
          placeholder="Unassigned"
          options={staff.map((s) => ({ value: s.id, label: s.name }))}
        />
        <TextField name="dueDate" label="Due date" type="date" state={formState} />
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="isClientTask" className="mt-0.5 size-4" defaultChecked={formState.values?.isClientTask === "on"} />
        <span>
          Client task: show it in the client’s portal and let them mark it done.
          <span className="block text-xs text-muted">Client tasks are not assigned to staff.</span>
        </span>
      </label>
      <SubmitButton pendingText="Adding…">Add task</SubmitButton>
    </form>
  );
}
