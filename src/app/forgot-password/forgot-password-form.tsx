"use client";

import { useActionState } from "react";
import Link from "next/link";
import { requestPasswordResetAction } from "@/app/actions/auth";
import { FormMessage, SubmitButton, TextField } from "@/components/form";
import { idleState } from "@/lib/action-state";

export function ForgotPasswordForm() {
  const [state, action] = useActionState(requestPasswordResetAction, idleState);
  return (
    <form action={action} className="space-y-4 rounded-lg border border-line bg-surface p-5" noValidate>
      <FormMessage state={state} />
      {state.status !== "success" ? (
        <>
          <TextField name="email" label="Account email" type="email" autoComplete="email" inputMode="email" required state={state} />
          <SubmitButton pendingText="Sending…" className="w-full">Send reset link</SubmitButton>
        </>
      ) : null}
      <p className="text-center text-sm text-muted">
        <Link href="/login" className="font-medium text-brand-ink hover:underline">Back to sign in</Link>
      </p>
    </form>
  );
}
