"use client";

import { useActionState } from "react";
import { completeClientTaskAction } from "@/app/actions/portal";
import { SubmitButton } from "@/components/form";
import { idleState } from "@/lib/action-state";

export function CompleteTaskButton({ taskId }: { taskId: string }) {
  const [state, action] = useActionState(completeClientTaskAction.bind(null, taskId), idleState);
  return (
    <form action={action} className="flex flex-col items-start gap-1 sm:items-end">
      <SubmitButton variant="secondary" pendingText="Saving…">
        Mark as done
      </SubmitButton>
      {state.status === "error" ? (
        <p role="alert" className="text-xs text-danger-ink">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
