"use client";

import { useActionState } from "react";
import { acceptInvitationAction } from "@/app/actions/auth";
import { FormMessage, SubmitButton, TextField } from "@/components/form";
import { idleState } from "@/lib/action-state";

export function SetupPasswordForm({ token }: { token: string }) {
  const [state, action] = useActionState(acceptInvitationAction, idleState);
  // Validation errors from the service use the field name "_form" for the password value itself.
  const passwordState = state.fieldErrors?._form
    ? { ...state, fieldErrors: { ...state.fieldErrors, password: state.fieldErrors._form } }
    : state;
  return (
    <form action={action} className="space-y-4 rounded-lg border border-line bg-surface p-5" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="token" value={token} />
      <TextField name="password" label="New password" type="password" autoComplete="new-password" required state={passwordState} hint="12 to 128 characters." />
      <TextField name="confirmPassword" label="Confirm password" type="password" autoComplete="new-password" required state={state} />
      <SubmitButton pendingText="Saving…" className="w-full">
        Set password
      </SubmitButton>
    </form>
  );
}
