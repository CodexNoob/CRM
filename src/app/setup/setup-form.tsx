"use client";

import { useActionState } from "react";
import { firstRunSetupAction } from "@/app/actions/auth";
import { FormMessage, SubmitButton, TextField } from "@/components/form";
import { idleState } from "@/lib/action-state";

export function SetupForm() {
  const [state, action] = useActionState(firstRunSetupAction, idleState);
  return (
    <form action={action} className="space-y-4 rounded-lg border border-line bg-surface p-5" noValidate>
      <FormMessage state={state} />
      <TextField
        name="setupCode"
        label="Setup code"
        type="password"
        autoComplete="off"
        required
        state={state}
        hint="The SETUP_CODE value from the server's environment settings."
      />
      <TextField name="name" label="Your name" autoComplete="name" required state={state} />
      <TextField name="email" label="Your email" type="email" inputMode="email" autoComplete="username" required state={state} />
      <TextField name="password" label="Password" type="password" autoComplete="new-password" required state={state} hint="At least 12 characters." />
      <TextField name="confirmPassword" label="Confirm password" type="password" autoComplete="new-password" required state={state} />
      <SubmitButton pendingText="Creating account…" className="w-full">
        Create admin account
      </SubmitButton>
    </form>
  );
}
