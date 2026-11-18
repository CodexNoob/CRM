"use client";

import { useActionState, useState } from "react";
import { FormMessage, SelectField, SubmitButton, textareaClass, TextField } from "@/components/form";
import { ButtonLink } from "@/components/ui";
import { idleState, type ActionState } from "@/lib/action-state";
import { BILLING_FREQUENCY_LABELS, PRIORITY_LABELS, PROPOSAL_STATUS_LABELS, ROLE_LABELS, SERVICE_LABELS } from "@/lib/labels";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

export interface EngagementFormValues {
  title: string;
  serviceType: string;
  description: string | null;
  taxYear: number | null;
  periodStart: string | null;
  periodEnd: string | null;
  startDate: string | null;
  dueDate: string | null;
  ownerId: string;
  feeCents: number | null;
  billingFrequency: string | null;
  priority: string;
  proposalStatus: string;
  acceptedOn: string | null;
  staffIds: string[];
}

const serviceOptions = Object.entries(SERVICE_LABELS).map(([value, label]) => ({ value, label }));
const billingOptions = Object.entries(BILLING_FREQUENCY_LABELS).map(([value, label]) => ({ value, label }));
const priorityOptions = Object.entries(PRIORITY_LABELS).map(([value, label]) => ({ value, label }));
const proposalOptions = (["not_required", "draft", "sent", "accepted"] as const).map((value) => ({ value, label: PROPOSAL_STATUS_LABELS[value] }));

const PROPOSAL_HELP: Record<string, string> = {
  not_required: "Work can start right away.",
  draft: "Saved as a draft. Work can’t start until the client accepts.",
  sent: "Waiting for the client to accept. Work can’t start yet (a manager can override).",
  accepted: "The client accepted. Work can start.",
};

/**
 * Create / edit an engagement. On create it also takes the team (staff checkboxes) and the
 * proposal status; on edit those are managed from the engagement page (Team tab, proposal panel).
 */
export function EngagementForm({
  action,
  staff,
  initial,
  cancelHref,
  submitLabel,
  mode = "create",
  clients,
  canAssign = true,
  actorId,
}: {
  action: Action;
  staff: { id: string; name: string; role: keyof typeof ROLE_LABELS }[];
  initial: Partial<EngagementFormValues>;
  cancelHref?: string;
  submitLabel: string;
  mode?: "create" | "edit";
  /** Shown as a client picker (creating from the engagements list). */
  clients?: { id: string; name: string }[];
  /** May pick someone other than themselves as manager / add staff. */
  canAssign?: boolean;
  actorId?: string;
}) {
  const [state, formAction] = useActionState(action, idleState);
  const [proposal, setProposal] = useState(state.values?.proposalStatus ?? initial.proposalStatus ?? "not_required");
  const managers = canAssign ? staff : staff.filter((s) => s.id === actorId || s.id === initial.ownerId);
  const ownerOptions = managers.map((s) => ({ value: s.id, label: `${s.name} (${ROLE_LABELS[s.role]})` }));
  const v = (k: keyof EngagementFormValues) => {
    const x = initial[k];
    return x === null || x === undefined ? undefined : String(x);
  };
  const fee = initial.feeCents !== null && initial.feeCents !== undefined ? (initial.feeCents / 100).toFixed(2) : undefined;

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <FormMessage state={state} />
      {clients ? (
        <SelectField name="clientId" label="Client" required state={state} options={clients.map((c) => ({ value: c.id, label: c.name }))} placeholder="Choose a client" />
      ) : null}

      <fieldset className="space-y-4">
        <legend className="mb-1 text-[12.5px] font-semibold uppercase tracking-wide text-muted">Service</legend>
        <TextField name="title" label="Engagement name" required state={state} defaultValue={v("title")} placeholder="e.g. Annual Tax Preparation 2026" />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField name="serviceType" label="Service type" required state={state} defaultValue={v("serviceType") ?? "individual_tax"} options={serviceOptions} />
          <SelectField name="priority" label="Priority" state={state} defaultValue={v("priority") ?? "normal"} options={priorityOptions} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="description" className="block text-[12.5px] font-medium text-ink">Scope of work</label>
          <textarea id="description" name="description" rows={3} maxLength={5000} defaultValue={state.values?.description ?? v("description")} className={textareaClass} placeholder="What the firm will do for the client" />
          {state.fieldErrors?.description ? <p className="text-[12px] text-danger-ink">{state.fieldErrors.description.join(" ")}</p> : null}
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField name="taxYear" label="Tax year" inputMode="numeric" state={state} defaultValue={v("taxYear")} hint="Tax engagements" />
          <TextField name="periodStart" label="Period start" type="date" state={state} defaultValue={v("periodStart")} />
          <TextField name="periodEnd" label="Period end" type="date" state={state} defaultValue={v("periodEnd")} />
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="mb-1 text-[12.5px] font-semibold uppercase tracking-wide text-muted">People and dates</legend>
        <div className="grid gap-4 sm:grid-cols-3">
          <SelectField name="ownerId" label="Engagement manager" required state={state} defaultValue={v("ownerId")} options={ownerOptions} placeholder="Choose a manager" />
          <TextField name="startDate" label="Start date" type="date" state={state} defaultValue={v("startDate")} />
          <TextField name="dueDate" label="Due date" type="date" state={state} defaultValue={v("dueDate")} />
        </div>
        {mode === "create" && canAssign && staff.length ? (
          <div>
            <p className="mb-1.5 text-[12.5px] font-medium text-ink">Staff</p>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {staff.map((s) => (
                <label key={s.id} className="flex items-center gap-2 text-[13px] text-ink">
                  <input type="checkbox" name="staffIds" value={s.id} defaultChecked={initial.staffIds?.includes(s.id)} className="size-4 accent-brand" />
                  {s.name} <span className="text-[12px] text-muted">{ROLE_LABELS[s.role]}</span>
                </label>
              ))}
            </div>
            {state.fieldErrors?.staffIds ? <p className="mt-1 text-[12px] text-danger-ink">{state.fieldErrors.staffIds.join(" ")}</p> : null}
            <p className="mt-1 text-[12px] text-muted">Staff get access to the client and see the engagement in their notifications.</p>
          </div>
        ) : null}
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="mb-1 text-[12.5px] font-semibold uppercase tracking-wide text-muted">Fee and acceptance</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField name="feeCents" label="Fee (USD)" inputMode="numeric" state={state} defaultValue={fee} placeholder="0.00" />
          <SelectField name="billingFrequency" label="Billing" state={state} defaultValue={v("billingFrequency")} options={billingOptions} placeholder="Not set" />
        </div>
        {mode === "create" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="proposalStatus" className="block text-[12.5px] font-medium text-ink">Proposal</label>
              <select id="proposalStatus" name="proposalStatus" value={proposal} onChange={(e) => setProposal(e.target.value)} className="block h-9 w-full rounded-md border border-line bg-surface px-2.5 text-[13px] text-ink shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/15 sm:h-8">
                {proposalOptions.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <p className="text-[12px] text-muted">{PROPOSAL_HELP[proposal]}</p>
            </div>
            {proposal === "accepted" ? <TextField name="acceptedOn" label="Accepted on" type="date" state={state} defaultValue={v("acceptedOn")} /> : null}
          </div>
        ) : (
          <p className="text-[12px] text-muted">Proposal status and the team are managed on the engagement page.</p>
        )}
      </fieldset>

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
