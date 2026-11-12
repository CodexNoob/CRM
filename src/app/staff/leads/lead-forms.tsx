"use client";

import { useActionState } from "react";
import { convertLeadAction, createLeadAction, updateLeadAction } from "@/app/actions/phase1";
import { FormMessage, SelectField, SubmitButton, TextField, textareaClass } from "@/components/form";
import { idleState } from "@/lib/action-state";
import { LEAD_SOURCE_LABELS, LEAD_STATUS_LABELS, SERVICE_LABELS } from "@/lib/labels";

const sourceOptions = Object.entries(LEAD_SOURCE_LABELS).map(([value, label]) => ({ value, label }));
const serviceOptions = Object.entries(SERVICE_LABELS).map(([value, label]) => ({ value, label }));
const statusOptions = (["new", "contacted", "qualified", "lost"] as const).map((s) => ({ value: s, label: LEAD_STATUS_LABELS[s] }));

export function NewLeadForm() {
  const [state, action] = useActionState(createLeadAction, idleState);
  return (
    <form action={action} className="space-y-3" noValidate>
      <FormMessage state={state} />
      <TextField name="name" label="Name" required state={state} />
      <TextField name="company" label="Company (if a business)" state={state} />
      <TextField name="email" label="Email" type="email" inputMode="email" state={state} />
      <TextField name="phone" label="Phone" type="tel" inputMode="tel" state={state} />
      <SelectField name="serviceInterest" label="Interested in" state={state} options={serviceOptions} placeholder="Not sure yet" />
      <SelectField name="source" label="Source" state={state} defaultValue="phone" options={sourceOptions} />
      <SubmitButton className="w-full">Add lead</SubmitButton>
    </form>
  );
}

export interface LeadFormValues {
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  serviceInterest: string | null;
  source: string;
  status: string;
  ownerId: string | null;
  followUpDate: string | null;
  notes: string | null;
  message: string | null;
}

export function EditLeadForm({ id, lead, staff }: { id: string; lead: LeadFormValues; staff: { id: string; name: string }[] }) {
  const [state, action] = useActionState(updateLeadAction.bind(null, id), idleState);
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormMessage state={state.status === "error" && state.fieldErrors?._form ? { ...state, message: state.fieldErrors._form.join(" ") } : state} />
      <input type="hidden" name="message" value={lead.message ?? ""} />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField name="status" label="Status" required state={state} defaultValue={lead.status} options={statusOptions} />
        <SelectField name="ownerId" label="Owner" state={state} defaultValue={lead.ownerId} options={staff.map((s) => ({ value: s.id, label: s.name }))} placeholder="Unassigned" />
        <TextField name="followUpDate" label="Follow-up date" type="date" state={state} defaultValue={lead.followUpDate} />
        <SelectField name="serviceInterest" label="Interested in" state={state} defaultValue={lead.serviceInterest} options={serviceOptions} placeholder="Not sure yet" />
        <TextField name="name" label="Name" required state={state} defaultValue={lead.name} />
        <TextField name="company" label="Company" state={state} defaultValue={lead.company} />
        <TextField name="email" label="Email" type="email" state={state} defaultValue={lead.email} />
        <TextField name="phone" label="Phone" type="tel" state={state} defaultValue={lead.phone} />
        <SelectField name="source" label="Source" state={state} defaultValue={lead.source} options={sourceOptions} />
      </div>
      <div className="space-y-1">
        <label htmlFor="notes" className="block text-[12.5px] font-medium text-ink">Internal notes</label>
        <textarea
          id="notes"
          name="notes"
          rows={4}
          maxLength={5000}
          defaultValue={state.values?.notes ?? lead.notes ?? ""}
          className={textareaClass}
        />
        <p className="text-[12px] text-muted">Visible to staff only.</p>
      </div>
      <SubmitButton>Save lead</SubmitButton>
    </form>
  );
}

export function ConvertLeadButton({ id }: { id: string }) {
  const [state, action] = useActionState(convertLeadAction.bind(null, id), idleState);
  return (
    <form action={action} className="space-y-2">
      <FormMessage state={state} />
      <SubmitButton pendingText="Converting…" className="w-full">
        Convert to client
      </SubmitButton>
      <p className="text-[12px] text-muted">Creates a client record from this lead and assigns it to you. You can then start an engagement and invite them to the portal.</p>
    </form>
  );
}
