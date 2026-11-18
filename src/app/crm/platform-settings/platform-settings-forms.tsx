"use client";

import Image from "next/image";
import { useActionState } from "react";
import { savePlatformProfileAction, updatePlatformInquiryStatusAction } from "@/app/actions/settings";
import { FormMessage, inputClass, SubmitButton, TextField, textareaClass } from "@/components/form";
import { idleState } from "@/lib/action-state";
import type { PlatformProfile } from "@/services/settings";
import { buttonClass } from "@/components/ui";

export function PlatformProfileForm({ profile }: { profile: PlatformProfile }) {
  const [state, action] = useActionState(savePlatformProfileAction, idleState);
  return (
    <form action={action} className="space-y-5" encType="multipart/form-data" noValidate>
      <FormMessage state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField name="name" label="Platform name" required state={state} defaultValue={profile.name} />
        <TextField name="websiteUrl" label="Official website URL" type="url" state={state} defaultValue={profile.websiteUrl} />
        <TextField name="officialEmail" label="Official email" type="email" state={state} defaultValue={profile.officialEmail} />
        <TextField name="phone" label="Business phone" type="tel" state={state} defaultValue={profile.phone} />
        <TextField name="addressLine1" label="Address line 1" state={state} defaultValue={profile.addressLine1} />
        <TextField name="addressLine2" label="Address line 2" state={state} defaultValue={profile.addressLine2} />
        <TextField name="salesEmail" label="Sales contact email" type="email" state={state} defaultValue={profile.salesEmail} />
        <TextField name="supportEmail" label="Technical support email" type="email" state={state} defaultValue={profile.supportEmail} />
        <TextField name="supportPhone" label="Technical support phone" type="tel" state={state} defaultValue={profile.supportPhone} />
      </div>
      <label className="block space-y-1.5">
        <span className="block text-[12.5px] font-medium text-ink">Platform description</span>
        <textarea name="description" rows={4} maxLength={2000} defaultValue={state.values?.description ?? profile.description} className={textareaClass} />
        {state.fieldErrors?.description ? <span className="block text-xs text-danger-ink">{state.fieldErrors.description.join(" ")}</span> : null}
      </label>
      <div className="space-y-2">
        <label htmlFor="logo" className="block text-[12.5px] font-medium text-ink">Platform logo</label>
        {profile.logoDataUrl ? <Image src={profile.logoDataUrl} alt="Current platform logo" width={80} height={80} unoptimized className="size-16 rounded border border-line object-contain p-1" /> : null}
        <input id="logo" name="logo" type="file" accept="image/png,image/jpeg" className={inputClass} />
        {state.fieldErrors?.logo ? <p className="text-xs text-danger-ink">{state.fieldErrors.logo.join(" ")}</p> : null}
        <p className="text-[12px] text-muted">PNG or JPEG, up to 1 MB. This logo is public on the platform website.</p>
        {profile.logoDataUrl ? <label className="flex items-center gap-2 text-xs text-muted"><input type="checkbox" name="removeLogo" /> Remove current logo</label> : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="reset" className={buttonClass("secondary")}>Cancel</button>
        <SubmitButton>Save platform profile</SubmitButton>
      </div>
    </form>
  );
}

export function PlatformInquiryStatusForm({ id, status }: { id: string; status: "new" | "in_progress" | "resolved" }) {
  const nextStatus = status === "new" ? "in_progress" : status === "in_progress" ? "resolved" : "new";
  const [state, action] = useActionState(updatePlatformInquiryStatusAction.bind(null, id, nextStatus), idleState);
  const label = nextStatus === "in_progress" ? "Start" : nextStatus === "resolved" ? "Resolve" : "Reopen";
  return (
    <div>
      <form action={action}><SubmitButton variant="ghost" pendingText="…" className="min-h-8 px-2 text-xs">{label}</SubmitButton></form>
      {state.status === "error" ? <p role="alert" className="mt-1 max-w-48 text-xs text-danger-ink">{state.message ?? "Could not update inquiry."}</p> : null}
    </div>
  );
}
