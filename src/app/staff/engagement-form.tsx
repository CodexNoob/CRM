"use client";

import { useActionState } from "react";
import { FormMessage, SelectField, SubmitButton, TextField } from "@/components/form";
import { ButtonLink } from "@/components/ui";
import { idleState, type ActionState } from "@/lib/action-state";
import { ROLE_LABELS, SERVICE_LABELS, STATUS_LABELS } from "@/lib/labels";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

export interface EngagementFormValues {
  title: string;
  serviceType: string;
  taxYear: number | null;
  status: string;
  ownerId: string;
  dueDate: string | null;
}

const serviceOptions = Object.entries(SERVICE_LABELS).map(([value, label]) => ({ value, label }));
const statusOptions = Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }));

export function EngagementForm({
  action,
  staff,
  initial,
  cancelHref,
  submitLabel,
}: {
  action: Action;
  staff: { id: string; name: string; role: keyof typeof ROLE_LABELS }[];
  initial: Partial<EngagementFormValues>;
  cancelHref?: string;
  submitLabel: string;
}) {
  const [state, formAction] = useActionState(action, idleState);
  const ownerOptions = staff.map((s) => ({ value: s.id, label: `${s.name} (${ROLE_LABELS[s.role]})` }));
  return (
    <form action={formAction} className="space-y-4" noValidate>
      <FormMessage state={state} />
      <TextField name="title" label="Title" required state={state} defaultValue={initial.title} placeholder="e.g. 2026 Form 1040" />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField name="serviceType" label="Service" required state={state} defaultValue={initial.serviceType ?? "individual_tax"} options={serviceOptions} />
        <TextField name="taxYear" label="Tax year" inputMode="numeric" state={state} defaultValue={initial.taxYear?.toString()} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField name="ownerId" label="Owner" required state={state} defaultValue={initial.ownerId} options={ownerOptions} placeholder="Choose an owner" />
        <SelectField name="status" label="Status" required state={state} defaultValue={initial.status ?? "not_started"} options={statusOptions} />
      </div>
      <TextField name="dueDate" label="Due date" type="date" state={state} defaultValue={initial.dueDate} />
      <div className="flex flex-wrap gap-2">
        <SubmitButton>{submitLabel}</SubmitButton>
        {cancelHref ? (
          <ButtonLink href={cancelHref} variant="secondary">
            Cancel
          </ButtonLink>
        ) : null}
      </div>
    </form>
  );
}
