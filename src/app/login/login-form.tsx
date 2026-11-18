"use client";

import { useActionState } from "react";
import { loginAction } from "@/app/actions/auth";
import { FormMessage, SubmitButton, TextField } from "@/components/form";
import { idleState } from "@/lib/action-state";
import Link from "next/link";

export function LoginForm() {
  const [state, action] = useActionState(loginAction, idleState);
  return (
    <form action={action} className="space-y-4 rounded-lg border border-line bg-surface p-5" noValidate>
      <FormMessage state={state} />
      <TextField name="email" label="Email" type="email" autoComplete="username" inputMode="email" required state={state} />
      <TextField name="password" label="Password" type="password" autoComplete="current-password" required state={state} />
      <div className="-mt-2 text-right text-sm">
        <Link href="/forgot-password" className="font-medium text-brand-ink hover:underline">Forgot password?</Link>
      </div>
      <SubmitButton pendingText="Signing in…" className="w-full">
        Sign in
      </SubmitButton>
    </form>
  );
}
