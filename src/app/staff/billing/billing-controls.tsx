"use client";

import { useActionState } from "react";
import { cancelFirmSubscriptionAction, startFirmCheckoutAction } from "@/app/actions/billing";
import { SubmitButton } from "@/components/form";
import { Alert } from "@/components/ui";
import { idleState } from "@/lib/action-state";

export function CheckoutButton({ interval, label, primary }: { interval: "month" | "year"; label: string; primary?: boolean }) {
  const [state, action] = useActionState(startFirmCheckoutAction.bind(null, interval), idleState);
  return (
    <form action={action} className="space-y-2">
      <SubmitButton pendingText="Opening PayPal…" variant={primary ? "primary" : "secondary"} className="w-full" size="lg">
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
