"use client";

import { useActionState, useEffect, useRef } from "react";
import { createAnnouncementAction, saveFirmProfileAction, toggleAnnouncementAction } from "@/app/actions/settings";
import { FormMessage, SubmitButton, TextField, textareaClass } from "@/components/form";
import { idleState } from "@/lib/action-state";

export function FirmProfileForm({ profile }: { profile: { name: string; tagline: string; phone: string; email: string; addressLines: string[]; hours: [string, string][] } }) {
  const [state, action] = useActionState(saveFirmProfileAction, idleState);
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormMessage state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField name="name" label="Firm name" required state={state} defaultValue={profile.name} />
        <TextField name="phone" label="Phone" type="tel" state={state} defaultValue={profile.phone} />
        <TextField name="email" label="Public email" type="email" state={state} defaultValue={profile.email} />
        <TextField name="tagline" label="Tagline" state={state} defaultValue={profile.tagline} />
        <TextField name="addressLine1" label="Address line 1" state={state} defaultValue={profile.addressLines[0]} />
        <TextField name="addressLine2" label="Address line 2" state={state} defaultValue={profile.addressLines[1]} />
      </div>
      <div className="space-y-1">
        <label htmlFor="hours" className="block text-[12.5px] font-medium text-ink">Office hours</label>
        <textarea
          id="hours"
          name="hours"
          rows={3}
          defaultValue={state.values?.hours ?? profile.hours.map(([d, h]) => `${d} | ${h}`).join("\n")}
          className={`${textareaClass} font-mono`}
        />
        <p className="text-[12px] text-muted">One per line: <code>Days | Hours</code>, e.g. <code>Monday – Friday | 9:00 AM – 5:00 PM</code></p>
      </div>
      <SubmitButton>Save firm profile</SubmitButton>
    </form>
  );
}

export function NewAnnouncementForm({ today }: { today: string }) {
  const [state, action] = useActionState(createAnnouncementAction, idleState);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.status === "success") ref.current?.reset();
  }, [state]);
  const s = state.status === "success" ? { ...state, values: undefined } : state;
  return (
    <form ref={ref} action={action} className="space-y-3" noValidate>
      <FormMessage state={state} />
      <TextField name="title" label="Title" required state={s} />
      <div className="space-y-1">
        <label htmlFor="body" className="block text-[12.5px] font-medium text-ink">Text <span className="text-danger">*</span></label>
        <textarea id="body" name="body" rows={3} maxLength={2000} defaultValue={s.values?.body} className={textareaClass} />
        {s.fieldErrors?.body ? <p className="text-xs text-danger-ink">{s.fieldErrors.body.join(" ")}</p> : null}
      </div>
      <TextField name="publishedOn" label="Date shown" type="date" required state={s} defaultValue={today} />
      <SubmitButton>Publish announcement</SubmitButton>
    </form>
  );
}

export function AnnouncementToggle({ id, published }: { id: string; published: boolean }) {
  const [, action] = useActionState(toggleAnnouncementAction.bind(null, id, !published), idleState);
  return (
    <form action={action}>
      <SubmitButton variant="ghost" pendingText="…" className="min-h-8 px-2 text-xs">
        {published ? "Hide from website" : "Show on website"}
      </SubmitButton>
    </form>
  );
}
