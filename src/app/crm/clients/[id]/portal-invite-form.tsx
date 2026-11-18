"use client";

import { useActionState } from "react";
import { createPortalInviteAction } from "@/app/actions/staff";
import { FormMessage, SubmitButton, TextField } from "@/components/form";
import { InviteLink } from "@/components/invite-link";
import { idleState } from "@/lib/action-state";

export function PortalInviteForm({ clientId }: { clientId: string }) {
  const [state, action] = useActionState(createPortalInviteAction.bind(null, clientId), idleState);
  const link = state.status === "success" ? state.data?.link : undefined;

  return (
    <form action={action} className="space-y-3" noValidate>
      <FormMessage state={state} />
      {link ? <InviteLink link={link} /> : null}
      <TextField name="name" label="Name" required state={state} />
      <TextField name="email" label="Email" type="email" inputMode="email" autoComplete="off" required state={state} />
      <SubmitButton variant="secondary" pendingText="Creating…" className="w-full">
        Create invitation link
      </SubmitButton>
      <p className="text-xs text-muted">Re-inviting an existing login replaces its earlier link and lets the person choose a new password.</p>
    </form>
  );
}
