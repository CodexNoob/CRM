"use client";

import { useActionState } from "react";
import Link from "next/link";
import { resetPasswordAction } from "@/app/actions/auth";
import { FormMessage, SubmitButton, TextField } from "@/components/form";
import { idleState } from "@/lib/action-state";

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, action] = useActionState(resetPasswordAction, idleState);
  const passwordState = state.fieldErrors?._form
    ? { ...state, fieldErrors: { ...state.fieldErrors, password: state.fieldErrors._form } }
    : state;
  return (
    <form action={action} className="space-y-4 rounded-lg border border-line bg-surface p-5" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="token" value={token} />
      <TextField name="password" label="New password" type="password" autoComplete="new-password" required state={passwordState} hint="12 to 128 characters." />
      <TextField name="confirmPassword" label="Confirm new password" type="password" autoComplete="new-password" required state={state} />
      <SubmitButton pendingText="Resetting…" className="w-full">Reset password</SubmitButton>
      <p className="text-center text-sm text-muted">
        <Link href="/forgot-password" className="font-medium text-brand-ink hover:underline">Request a new link</Link>
      </p>
    </form>
  );
}
