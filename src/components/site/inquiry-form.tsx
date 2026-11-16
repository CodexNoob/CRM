"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { submitInquiryAction } from "@/app/actions/public";
import { FormMessage, SelectField, SubmitButton, TextField, textareaClass } from "@/components/form";
import { formValues, idleState, type ActionState } from "@/lib/action-state";
import { buttonClass } from "@/components/ui";

const topicOptions = [
  { value: "sales", label: "Sales and pricing" },
  { value: "technical_support", label: "Technical support" },
  { value: "general", label: "General question" },
];

const CONSENT_MESSAGE = "Please check the box to agree to be contacted before sending your message.";

/**
 * Public contact form for the CRM operator. Requests are stored separately from
 * subscribing firms' leads and are visible only to Super Admins.
 */
export function InquiryForm() {
  // Changing the key remounts the form: empty fields, fresh state, new fill-time start.
  const [formKey, setFormKey] = useState(0);
  return <InquiryFormBody key={formKey} onSendAnother={() => setFormKey((k) => k + 1)} />;
}

function InquiryFormBody({ onSendAnother }: { onSendAnother: () => void }) {
  const successRef = useRef<HTMLDivElement>(null);
  // When the visitor first saw the form. Kept in a ref (not a hidden input) because React
  // resets the form after each submit, which used to blank the field and make retries look like bots.
  const startedAt = useRef(0);
  useEffect(() => {
    startedAt.current = Date.now();
  }, []);

  const [state, action] = useActionState(async (prev: ActionState, formData: FormData): Promise<ActionState> => {
    // Catch the unchecked box here, with a clear message, before anything is sent.
    if (formData.get("consent") !== "on") {
      // Shown once, next to the checkbox (no duplicate banner at the top of the form).
      return { status: "error", fieldErrors: { consent: [CONSENT_MESSAGE] }, values: formValues(formData) };
    }
    formData.set("startedAt", String(startedAt.current));
    return submitInquiryAction(prev, formData);
  }, idleState);

  // Move focus to the confirmation so keyboard and screen-reader users hear it.
  useEffect(() => {
    if (state.status === "success") successRef.current?.focus();
  }, [state.status]);

  if (state.status === "success") {
    return (
      <div ref={successRef} tabIndex={-1} role="status" className="flex flex-1 flex-col items-center justify-center gap-2 py-6 text-center outline-none">
        <p className="text-lg font-semibold text-ink">Message received</p>
        <p className="max-w-sm text-sm text-muted">{state.message}</p>
        <button type="button" onClick={onSendAnother} className={buttonClass("secondary", "mt-3")}>
          Send another message
        </button>
      </div>
    );
  }

  return (
    <form action={action} className="flex h-full flex-col gap-3" noValidate>
      <FormMessage state={state} />
      {/* Honeypot: invisible to people, tempting to bots. */}
      <div aria-hidden className="absolute left-[-9999px] h-px w-px overflow-hidden">
        <label htmlFor="website">Leave this field empty</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField name="name" label="Name" autoComplete="name" required state={state} />
        <TextField name="email" label="Email" type="email" inputMode="email" autoComplete="email" required state={state} />
        <TextField name="phone" label="Phone (optional)" type="tel" inputMode="tel" autoComplete="tel" state={state} />
        <SelectField name="topic" label="Topic" required state={state} options={topicOptions} placeholder="Choose a topic" />
      </div>
      <div className="flex flex-1 flex-col gap-1.5">
        <label htmlFor="message" className="block text-[12.5px] font-medium text-ink">How can we help?</label>
        <textarea
          id="message"
          name="message"
          rows={3}
          maxLength={2000}
          required
          defaultValue={state.values?.message}
          className={`${textareaClass} flex-1 resize-none`}
          placeholder="Please don’t include passwords, tax documents, or other sensitive information."
        />
      </div>
      <label
        className={
          "flex items-start gap-2 rounded-md text-[13px] text-ink " +
          (state.fieldErrors?.consent ? "border border-danger bg-danger-soft p-2.5" : "")
        }
      >
        <input
          type="checkbox"
          name="consent"
          className="mt-0.5 size-4 accent-brand"
          defaultChecked={state.values?.consent === "on"}
          aria-invalid={state.fieldErrors?.consent ? true : undefined}
          aria-describedby={state.fieldErrors?.consent ? "consent-error" : undefined}
        />
        <span>
          I agree to be contacted about my inquiry by phone or email.
          {state.fieldErrors?.consent ? (
            <span id="consent-error" role="alert" className="mt-0.5 block text-xs font-medium text-danger-ink">
              {state.fieldErrors.consent.join(" ")}
            </span>
          ) : null}
        </span>
      </label>
      <SubmitButton pendingText="Sending…" className="w-full" size="lg">
        Send message
      </SubmitButton>
    </form>
  );
}
