"use client";

import { useActionState, useEffect, useRef } from "react";
import { SendHorizontal } from "lucide-react";
import { FormMessage, SubmitButton, textareaClass } from "@/components/form";
import { idleState, type ActionState } from "@/lib/action-state";

/** A short client-visible message into the client's General conversation. */
export function QuickMessage({ action }: { action: (prev: ActionState, formData: FormData) => Promise<ActionState> }) {
  const [state, formAction] = useActionState(action, idleState);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.status === "success") ref.current?.reset();
  }, [state]);
  return (
    <form ref={ref} action={formAction} className="space-y-2" noValidate>
      <FormMessage state={state.status === "error" ? { ...state, message: state.fieldErrors?._form?.join(" ") ?? state.message } : state} />
      <label htmlFor="quick-body" className="sr-only">Message</label>
      <textarea id="quick-body" name="body" rows={4} maxLength={5000} required className={textareaClass} placeholder="Visible to the client in their portal…" />
      <div className="flex justify-end">
        <SubmitButton pendingText="Sending…">
          <SendHorizontal /> Send
        </SubmitButton>
      </div>
    </form>
  );
}
