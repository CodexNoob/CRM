"use client";

import { useActionState } from "react";
import { requestContactChangeAction, updatePortalNameAction } from "@/app/actions/portal";
import { FormMessage, SubmitButton, TextField, textareaClass } from "@/components/form";
import { idleState } from "@/lib/action-state";

export function NameForm({ name }: { name: string }) {
  const [state, action] = useActionState(updatePortalNameAction, idleState);
  return (
    <form action={action} className="space-y-3" noValidate>
      <FormMessage state={state} />
      <TextField name="name" label="Your name" autoComplete="name" required state={state} defaultValue={name} />
      <SubmitButton pendingText="Saving…">Save name</SubmitButton>
    </form>
  );
}

export function ContactChangeForm() {
  const [state, action] = useActionState(requestContactChangeAction, idleState);
  return (
    <form action={action} className="space-y-3" noValidate>
      <FormMessage state={state} />
      {state.fieldErrors?._form ? <p role="alert" className="text-xs text-danger-ink">{state.fieldErrors._form.join(" ")}</p> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField name="phone" label="New phone" type="tel" inputMode="tel" autoComplete="tel" state={state} />
        <TextField name="email" label="New email" type="email" inputMode="email" autoComplete="email" state={state} />
      </div>
      <TextField name="address" label="New address" autoComplete="street-address" state={state} />
      <div className="space-y-1.5">
        <label htmlFor="note" className="block text-[12.5px] font-medium text-ink">
          Anything we should know? (optional)
        </label>
        <textarea id="note" name="note" rows={2} maxLength={1000} className={textareaClass} defaultValue={state.values?.note} />
      </div>
      <SubmitButton pendingText="Sending…" variant="secondary">
        Send change request
      </SubmitButton>
    </form>
  );
}
