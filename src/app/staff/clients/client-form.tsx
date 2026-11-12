"use client";

import { useActionState, useState } from "react";
import { FormMessage, SelectField, SubmitButton, TextField, textareaClass } from "@/components/form";
import { ButtonLink } from "@/components/ui";
import { idleState, type ActionState } from "@/lib/action-state";
import { CLIENT_STATUS_LABELS, CLIENT_TYPE_LABELS } from "@/lib/labels";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

export interface ClientFormValues {
  type: string;
  displayName: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  status: string;
  accountManagerId: string | null;
  notes: string | null;
}

const typeOptions = Object.entries(CLIENT_TYPE_LABELS).map(([value, label]) => ({ value, label }));
const statusOptions = Object.entries(CLIENT_STATUS_LABELS).map(([value, label]) => ({ value, label }));

export function ClientForm({
  action,
  initial,
  cancelHref,
  submitLabel,
  staff,
  canAssign,
}: {
  action: Action;
  initial?: ClientFormValues;
  cancelHref: string;
  submitLabel: string;
  staff: { value: string; label: string }[];
  canAssign: boolean;
}) {
  const [state, formAction] = useActionState(action, idleState);
  const [type, setType] = useState(state.values?.type ?? initial?.type ?? "individual");
  const managerName = staff.find((s) => s.value === initial?.accountManagerId)?.label;

  return (
    <form action={formAction} className="max-w-2xl space-y-4" noValidate>
      <FormMessage state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="type" className="block text-[12.5px] font-medium text-ink">
            Client type<span className="text-danger" aria-hidden> *</span>
          </label>
          <select
            id="type"
            name="type"
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="block h-9 w-full rounded-md border border-line bg-surface px-2.5 pr-7 text-[13px] text-ink shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/15 sm:h-8"
          >
            {typeOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <SelectField name="status" label="Status" state={state} defaultValue={initial?.status ?? "onboarding"} options={statusOptions} hint={initial ? undefined : "New clients start in onboarding."} />
      </div>

      <TextField
        name="displayName"
        label={type === "business" ? "Business name" : type === "household" ? "Household name" : "Full name"}
        required
        state={state}
        defaultValue={initial?.displayName}
        hint={type === "household" ? "For example “Rivera Household”." : type === "business" ? "Legal or trading name. Add people under Contacts." : undefined}
      />
      {type !== "business" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField name="firstName" label="First name" autoComplete="off" state={state} defaultValue={initial?.firstName} />
          <TextField name="lastName" label="Last name" autoComplete="off" state={state} defaultValue={initial?.lastName} />
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField name="email" label="Email" type="email" inputMode="email" autoComplete="off" state={state} defaultValue={initial?.email} />
        <TextField name="phone" label="Phone" type="tel" inputMode="tel" autoComplete="off" state={state} defaultValue={initial?.phone} />
      </div>
      <TextField name="address" label="Address" autoComplete="off" state={state} defaultValue={initial?.address} />

      {canAssign ? (
        <SelectField name="accountManagerId" label="Account manager" state={state} defaultValue={initial?.accountManagerId ?? ""} options={staff} placeholder="None" />
      ) : (
        <>
          {/* Keep the current manager when the user can't reassign. */}
          <input type="hidden" name="accountManagerId" value={initial?.accountManagerId ?? ""} />
          {initial ? <p className="text-[12.5px] text-muted">Account manager: {managerName ?? "None"}</p> : null}
        </>
      )}

      <div className="space-y-1.5">
        <label htmlFor="notes" className="block text-[12.5px] font-medium text-ink">
          Internal notes
        </label>
        <textarea id="notes" name="notes" rows={3} maxLength={5000} defaultValue={state.values?.notes ?? initial?.notes ?? ""} className={textareaClass} />
        {state.fieldErrors?.notes ? <p className="text-[12px] text-danger-ink">{state.fieldErrors.notes.join(" ")}</p> : null}
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
