"use client";

import { useActionState, useEffect, useRef } from "react";
import { cancelAppointmentAction, createAppointmentAction } from "@/app/actions/phase1";
import { FormMessage, SelectField, SubmitButton, TextField } from "@/components/form";
import { idleState } from "@/lib/action-state";
import { APPOINTMENT_KIND_LABELS } from "@/lib/labels";

const kindOptions = Object.entries(APPOINTMENT_KIND_LABELS)
  .filter(([k]) => k !== "internal")
  .map(([value, label]) => ({ value, label }));
const durations = [15, 30, 45, 60, 90, 120].map((m) => ({ value: String(m), label: m < 60 ? `${m} minutes` : `${m / 60} hour${m > 60 ? "s" : ""}` }));

export function AppointmentForm({
  clients,
  staff,
  defaultOwnerId,
  defaultStart,
}: {
  clients: { id: string; name: string }[];
  staff: { id: string; name: string }[];
  defaultOwnerId: string;
  defaultStart: string;
}) {
  const [state, action] = useActionState(createAppointmentAction, idleState);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.status === "success") ref.current?.reset();
  }, [state]);
  const s = state.status === "success" ? { ...state, values: undefined } : state;

  return (
    <form ref={ref} action={action} className="space-y-3" noValidate>
      <FormMessage state={state} />
      <TextField name="title" label="Title" required state={s} placeholder="e.g. 2026 return review" />
      <SelectField name="clientId" label="Client" state={s} options={clients.map((c) => ({ value: c.id, label: c.name }))} placeholder="None (internal meeting)" />
      <SelectField name="ownerId" label="With" required state={s} defaultValue={defaultOwnerId} options={staff.map((m) => ({ value: m.id, label: m.name }))} />
      <SelectField name="kind" label="Type" required state={s} defaultValue="in_person" options={kindOptions} />
      <TextField name="startsAt" label="Starts" type="datetime-local" required state={s} defaultValue={defaultStart} hint="Firm local time." />
      <SelectField name="durationMinutes" label="Length" required state={s} defaultValue="60" options={durations} />
      <TextField name="location" label="Location or call link" state={s} />
      <SubmitButton className="w-full">Add appointment</SubmitButton>
      <p className="text-xs text-muted">Clients see appointments with them in their portal. Meetings without a client are internal.</p>
    </form>
  );
}

export function CancelAppointmentButton({ id, title }: { id: string; title: string }) {
  const [state, action] = useActionState(cancelAppointmentAction.bind(null, id), idleState);
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm(`Cancel “${title}”?`)) e.preventDefault();
      }}
      className="shrink-0"
    >
      <SubmitButton variant="ghost" pendingText="…" className="min-h-8 px-2 text-xs">
        Cancel
      </SubmitButton>
      {state.status === "error" ? <span role="alert" className="block text-xs text-danger-ink">{state.message}</span> : null}
    </form>
  );
}
