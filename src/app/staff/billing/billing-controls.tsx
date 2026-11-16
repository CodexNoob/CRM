"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  cancelFirmSubscriptionAction,
  cancelPendingFirmCheckoutAction,
  startFirmCheckoutAction,
} from "@/app/actions/billing";
import { SubmitButton } from "@/components/form";
import { Alert } from "@/components/ui";
import { idleState } from "@/lib/action-state";

export function CheckoutButton({ interval, label, primary, disabled = false }: { interval: "month" | "year"; label: string; primary?: boolean; disabled?: boolean }) {
  const [state, action] = useActionState(startFirmCheckoutAction.bind(null, interval), idleState);
  return (
    <form action={action} className="space-y-2">
      <SubmitButton disabled={disabled} pendingText="Opening PayPal…" variant={primary ? "primary" : "secondary"} className="w-full" size="lg">
        {label}
      </SubmitButton>
      {state.status === "error" ? <Alert tone="error">{state.fieldErrors?._form?.join(" ") ?? state.message}</Alert> : null}
    </form>
  );
}

export function CancelSubscriptionButton() {
  const [state, action] = useActionState(cancelFirmSubscriptionAction, idleState);
  if (state.status === "success") return <Alert tone="success">{state.message}</Alert>;
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm("Cancel your subscription? You keep access until the end of the period you’ve paid for.")) e.preventDefault();
      }}
      className="space-y-2"
    >
      <SubmitButton pendingText="Cancelling…" variant="ghost" className="text-danger-ink">
        Cancel subscription
      </SubmitButton>
      {state.status === "error" ? <Alert tone="error">{state.fieldErrors?._form?.join(" ") ?? state.message}</Alert> : null}
    </form>
  );
}

export function CancelPendingCheckoutButton() {
  const [state, action] = useActionState(cancelPendingFirmCheckoutAction, idleState);
  const router = useRouter();

  useEffect(() => {
    if (state.status === "success") router.refresh();
  }, [state.status, router]);

  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm("Cancel this pending PayPal checkout? You can choose a plan again afterward.")) e.preventDefault();
      }}
      className="space-y-2"
    >
      <SubmitButton pendingText="Cancelling…" variant="ghost" className="text-danger-ink">
        Cancel pending checkout
      </SubmitButton>
      {state.status === "success" ? <Alert tone="success">{state.message}</Alert> : null}
      {state.status === "error" ? <Alert tone="error">{state.fieldErrors?._form?.join(" ") ?? state.message}</Alert> : null}
    </form>
  );
}
