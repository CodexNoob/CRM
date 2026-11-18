"use client";

import { useActionState, useState } from "react";
import { MessageSquarePlus, Paperclip } from "lucide-react";
import { portalCreateConversationAction } from "@/app/actions/messages";
import { FormMessage, SelectField, SubmitButton, TextField, textareaClass } from "@/components/form";
import { buttonClass } from "@/components/ui";
import { idleState } from "@/lib/action-state";
import { ACCEPT_ATTRIBUTE } from "@/lib/file-rules";
import { CONVERSATION_CATEGORY_LABELS } from "@/app/crm/messages/conversation-labels";

const categories = Object.entries(CONVERSATION_CATEGORY_LABELS).map(([value, label]) => ({ value, label }));

/** Client starts a new conversation with the firm. */
export function PortalNewConversation({ startOpen = false }: { startOpen?: boolean }) {
  const [open, setOpen] = useState(startOpen);
  const [state, action] = useActionState(portalCreateConversationAction, idleState);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={buttonClass("primary")}>
        <MessageSquarePlus /> New message
      </button>
    );
  }
  return (
    <form action={action} className="space-y-3 rounded-lg border border-line bg-surface p-4" noValidate>
      <FormMessage state={state} />
      <div className="grid gap-3 sm:grid-cols-[1fr_14rem]">
        <TextField name="subject" label="Subject" required state={state} placeholder="Question about my 2026 return" />
        <SelectField name="category" label="Topic" state={state} options={categories} defaultValue="general_inquiry" />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="portal-new-body" className="block text-[12.5px] font-medium text-ink">
          Message<span className="text-danger" aria-hidden> *</span>
        </label>
        <textarea id="portal-new-body" name="body" rows={5} maxLength={5000} required defaultValue={state.values?.body} className={textareaClass} placeholder="Please don’t include full Social Security or account numbers." />
        {state.fieldErrors?.body ? <p className="text-[12px] text-danger-ink">{state.fieldErrors.body.join(" ")}</p> : null}
      </div>
      <label className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
        <Paperclip className="size-3.5" aria-hidden /> Attach files (optional, up to 5)
        <input type="file" name="attachments" multiple accept={ACCEPT_ATTRIBUTE} className="text-[12px]" />
      </label>
      {state.fieldErrors?.attachments ? <p className="text-[12px] text-danger-ink">{state.fieldErrors.attachments.join(" ")}</p> : null}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => setOpen(false)} className={buttonClass("ghost")}>Cancel</button>
        <SubmitButton pendingText="Sending…">Send</SubmitButton>
      </div>
    </form>
  );
}
