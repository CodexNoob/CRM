"use client";

import Image from "next/image";
import { useActionState, useEffect, useRef } from "react";
import { createAnnouncementAction, saveFirmProfileAction, toggleAnnouncementAction } from "@/app/actions/settings";
import { FormMessage, inputClass, SubmitButton, TextField, textareaClass } from "@/components/form";
import { buttonClass } from "@/components/ui";
import { idleState } from "@/lib/action-state";
import type { OrganizationProfile } from "@/services/settings";

export function FirmProfileForm({ profile, firmId }: { profile: OrganizationProfile; firmId: string }) {
  const [state, action] = useActionState(saveFirmProfileAction, idleState);
  return (
    <form action={action} className="space-y-5" encType="multipart/form-data" noValidate>
      <input type="hidden" name="firmId" value={firmId} />
      <FormMessage state={state} />
      <div>
        <h3 className="text-sm font-semibold text-ink">Business information</h3>
        <p className="mt-1 text-xs text-muted">Private to your firm and its authenticated client portal.</p>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <TextField name="name" label="Organization name" required state={state} defaultValue={profile.name} />
          <TextField name="tagline" label="Tagline" state={state} defaultValue={profile.tagline} />
          <TextField name="phone" label="Business phone" type="tel" state={state} defaultValue={profile.phone} />
          <TextField name="email" label="Business email" type="email" state={state} defaultValue={profile.email} />
          <TextField name="websiteUrl" label="Website URL" type="url" state={state} defaultValue={profile.websiteUrl} />
          <TextField name="addressLine1" label="Address line 1" state={state} defaultValue={profile.addressLine1} />
          <TextField name="addressLine2" label="Address line 2" state={state} defaultValue={profile.addressLine2} />
        </div>
      </div>

      <label className="block space-y-1.5">
        <span className="block text-[12.5px] font-medium text-ink">Description</span>
        <textarea name="description" rows={3} maxLength={2000} defaultValue={state.values?.description ?? profile.description} className={textareaClass} />
        {state.fieldErrors?.description ? <span className="block text-xs text-danger-ink">{state.fieldErrors.description.join(" ")}</span> : null}
        <span className="block text-[12px] text-muted">For internal and client-portal context; not published publicly.</span>
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="hours" className="block text-[12.5px] font-medium text-ink">Office hours</label>
          <textarea id="hours" name="hours" rows={3} defaultValue={state.values?.hours ?? profile.hours.map(([d, h]) => `${d} | ${h}`).join("\n")} className={`${textareaClass} font-mono`} />
          <p className="text-[12px] text-muted">One per line: <code>Days | Hours</code>.</p>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="socialLinks" className="block text-[12.5px] font-medium text-ink">Social links</label>
          <textarea id="socialLinks" name="socialLinks" rows={3} defaultValue={state.values?.socialLinks ?? profile.socialLinks.map((item) => `${item.label} | ${item.url}`).join("\n")} className={`${textareaClass} font-mono`} />
          {state.fieldErrors?.socialLinks ? <p className="text-xs text-danger-ink">{state.fieldErrors.socialLinks.join(" ")}</p> : null}
          <p className="text-[12px] text-muted">One per line: <code>Network | https://example.com</code>.</p>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-ink">Regional settings</h3>
        <p className="mt-1 text-xs text-muted">Saved as organization preferences. Existing filing-date and payment-currency calculations still use the app-wide configuration.</p>
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          <TextField name="timeZone" label="Time zone" required state={state} defaultValue={profile.timeZone} placeholder="America/New_York" />
          <TextField name="locale" label="Locale" required state={state} defaultValue={profile.locale} placeholder="en-US" />
          <TextField name="currency" label="Currency" required state={state} defaultValue={profile.currency} placeholder="USD" />
        </div>
      </div>

      <div className="space-y-2">
        <label htmlFor="logo" className="block text-[12.5px] font-medium text-ink">Organization logo</label>
        {profile.logoDataUrl ? <Image src={profile.logoDataUrl} alt="Current organization logo" width={80} height={80} unoptimized className="size-16 rounded border border-line object-contain p-1" /> : null}
        <input id="logo" name="logo" type="file" accept="image/png,image/jpeg" className={inputClass} />
        {state.fieldErrors?.logo ? <p className="text-xs text-danger-ink">{state.fieldErrors.logo.join(" ")}</p> : null}
        <p className="text-[12px] text-muted">PNG or JPEG, up to 1 MB. Used only in your authenticated workspace and client portal.</p>
        {profile.logoDataUrl ? <label className="flex items-center gap-2 text-xs text-muted"><input type="checkbox" name="removeLogo" /> Remove current logo</label> : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="reset" className={buttonClass("secondary")}>Cancel</button>
        <SubmitButton>Save organization profile</SubmitButton>
      </div>
    </form>
  );
}

export function NewAnnouncementForm({ today, firmId }: { today: string; firmId: string }) {
  const [state, action] = useActionState(createAnnouncementAction, idleState);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.status === "success") ref.current?.reset();
  }, [state]);
  const s = state.status === "success" ? { ...state, values: undefined } : state;
  return (
    <form ref={ref} action={action} className="space-y-3" noValidate>
      <input type="hidden" name="firmId" value={firmId} />
      <FormMessage state={state} />
      <TextField name="title" label="Title" required state={s} />
      <div className="space-y-1">
        <label htmlFor="body" className="block text-[12.5px] font-medium text-ink">Text <span className="text-danger">*</span></label>
        <textarea id="body" name="body" rows={3} maxLength={2000} defaultValue={s.values?.body} className={textareaClass} />
        {s.fieldErrors?.body ? <p className="text-xs text-danger-ink">{s.fieldErrors.body.join(" ")}</p> : null}
      </div>
      <TextField name="publishedOn" label="Date shown" type="date" required state={s} defaultValue={today} />
      <SubmitButton>Publish to client portal</SubmitButton>
    </form>
  );
}

export function AnnouncementToggle({ id, published, firmId }: { id: string; published: boolean; firmId: string }) {
  const [state, action] = useActionState(toggleAnnouncementAction.bind(null, id, !published, firmId), idleState);
  return (
    <div>
      <form action={action}>
        <SubmitButton variant="ghost" pendingText="…" className="min-h-8 px-2 text-xs">
          {published ? "Hide from client portal" : "Show in client portal"}
        </SubmitButton>
      </form>
      {state.status === "error" ? <p role="alert" className="mt-1 max-w-48 text-xs text-danger-ink">{state.message ?? "Could not update announcement."}</p> : null}
    </div>
  );
}
