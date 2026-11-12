"use client";

import { useActionState } from "react";
import { FormMessage, SelectField, SubmitButton, TextField } from "@/components/form";
import { ButtonLink } from "@/components/ui";
import { idleState, type ActionState } from "@/lib/action-state";
import { CLIENT_STATUS_LABELS, CLIENT_TYPE_LABELS } from "@/lib/labels";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

export interface ClientFormValues {
  type: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  status: string;
}

const typeOptions = Object.entries(CLIENT_TYPE_LABELS).map(([value, label]) => ({ value, label }));
const statusOptions = Object.entries(CLIENT_STATUS_LABELS).map(([value, label]) => ({ value, label }));

export function ClientForm({ action, initial, cancelHref, submitLabel }: { action: Action; initial?: ClientFormValues; cancelHref: string; submitLabel: string }) {
  const [state, formAction] = useActionState(action, idleState);
  return (
    <form action={formAction} className="max-w-xl space-y-4" noValidate>
      <FormMessage state={state} />
      <TextField name="displayName" label="Name" required state={state} defaultValue={initial?.displayName} hint="Person, household (e.g. “Rivera Household”) or business name." />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField name="type" label="Client type" required state={state} defaultValue={initial?.type ?? "individual"} options={typeOptions} />
        <SelectField name="status" label="Status" state={state} defaultValue={initial?.status ?? "active"} options={statusOptions} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField name="email" label="Email" type="email" inputMode="email" autoComplete="off" state={state} defaultValue={initial?.email} />
        <TextField name="phone" label="Phone" type="tel" inputMode="tel" autoComplete="off" state={state} defaultValue={initial?.phone} />
      </div>
      <p className="text-xs text-muted">Do not enter SSNs, EINs or bank details here. This record does not store tax identifiers.</p>
      <div className="flex flex-wrap gap-2">
        <SubmitButton>{submitLabel}</SubmitButton>
        <ButtonLink href={cancelHref} variant="secondary">
          Cancel
        </ButtonLink>
      </div>
    </form>
  );
}
