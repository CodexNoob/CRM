"use client";

import { useActionState, useEffect, useRef } from "react";
import { signUpAction } from "@/app/actions/billing";
import { FormMessage, SubmitButton, TextField } from "@/components/form";
import { idleState } from "@/lib/action-state";

export function SignupForm() {
  const [state, action] = useActionState(signUpAction, idleState);
  // Bot check: when the visitor first saw the form (kept in a ref; React resets forms after submit).
  const startedAt = useRef(0);
  useEffect(() => {
    startedAt.current = Date.now();
  }, []);

  return (
    <form
      action={(fd: FormData) => {
        fd.set("startedAt", String(startedAt.current));
        return action(fd);
      }}
      className="space-y-4 rounded-lg border border-line bg-surface p-5"
      noValidate
    >
      <FormMessage state={state} />
      {/* Honeypot: invisible to people, tempting to bots. */}
      <div aria-hidden className="absolute left-[-9999px] h-px w-px overflow-hidden">
        <label htmlFor="website">Leave this field empty</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>
      <TextField name="firmName" label="Firm name" autoComplete="organization" required state={state} placeholder="Rivera Tax & Accounting" />
      <TextField name="name" label="Your name" autoComplete="name" required state={state} />
      <TextField name="email" label="Work email" type="email" inputMode="email" autoComplete="username" required state={state} />
      <TextField name="password" label="Password" type="password" autoComplete="new-password" required state={state} hint="At least 12 characters." />
      <TextField name="confirmPassword" label="Confirm password" type="password" autoComplete="new-password" required state={state} />
      <label className="flex items-start gap-2 text-[13px] text-ink">
        <input type="checkbox" name="terms" className="mt-0.5 size-4 accent-brand" defaultChecked={state.values?.terms === "on"} />
        <span>
          I’m authorized to create this account for my firm, and I’ll only add client data my firm is permitted to store.
          {state.fieldErrors?.terms ? <span role="alert" className="block text-xs text-danger-ink">{state.fieldErrors.terms.join(" ")}</span> : null}
        </span>
      </label>
      <SubmitButton pendingText="Creating your workspace…" className="w-full" size="lg">
        Start free trial
      </SubmitButton>
    </form>
  );
}
