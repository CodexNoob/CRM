"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createInvoiceAction, createSubscriptionAction, invoiceRowAction, portalSubscribeAction, subscriptionRowAction } from "@/app/actions/invoices";
import { FormMessage, inputClass, SelectField, SubmitButton, textareaClass, TextField } from "@/components/form";
import { Alert, buttonClass, cx } from "@/components/ui";
import { idleState, type ActionState } from "@/lib/action-state";

const MAX_ITEMS = 10;

function centsFrom(v: FormDataEntryValue | null): number {
  const s = typeof v === "string" ? v.replace(/[$,\s]/g, "") : "";
  return /^\d+(\.\d{1,2})?$/.test(s) ? Math.round(Number(s) * 100) : 0;
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** Staff form: creates the invoice in PayPal and emails it to the client. */
export function NewInvoiceForm({ clientId, clientEmail, engagements, firmId }: { clientId: string; clientEmail: string | null; engagements: { value: string; label: string }[]; firmId?: string }) {
  const [formKey, setFormKey] = useState(0);
  return <NewInvoiceFormBody key={formKey} clientId={clientId} clientEmail={clientEmail} engagements={engagements} firmId={firmId} onReset={() => setFormKey((k) => k + 1)} />;
}

function NewInvoiceFormBody({ clientId, clientEmail, engagements, firmId, onReset }: { clientId: string; clientEmail: string | null; engagements: { value: string; label: string }[]; firmId?: string; onReset: () => void }) {
  const [state, action] = useActionState(createInvoiceAction.bind(null, clientId), idleState);
  const [rows, setRows] = useState(() => Math.max(1, countRows(state)));
  const [total, setTotal] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);

  const recalc = () => {
    if (!formRef.current) return;
    const fd = new FormData(formRef.current);
    let t = 0;
    for (let i = 0; i < MAX_ITEMS; i++) {
      const qty = Number(fd.get(`item${i}Qty`) || 1);
      t += (Number.isInteger(qty) && qty > 0 ? qty : 0) * centsFrom(fd.get(`item${i}Amount`));
    }
    setTotal(t);
  };

  if (state.status === "success") {
    return (
      <div className="space-y-3">
        <Alert tone="success">{state.message}</Alert>
        <button type="button" onClick={onReset} className={buttonClass("secondary")}>
          Create another invoice
        </button>
      </div>
    );
  }

  if (!clientEmail) {
    return <Alert tone="warning">Add an email address to this client first. PayPal emails the invoice and payment link to that address.</Alert>;
  }

  return (
    <form ref={formRef} action={action} onInput={recalc} className="space-y-4" noValidate>
      {firmId ? <input type="hidden" name="firmId" value={firmId} /> : null}
      <FormMessage state={state} />
      {state.fieldErrors?._form ? <Alert tone="error">{state.fieldErrors._form.join(" ")}</Alert> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField name="title" label="Invoice title" required state={state} placeholder="2026 Individual tax return" />
        <TextField name="dueDate" label="Due date" type="date" state={state} hint="Leave blank for “due on receipt”." />
        {engagements.length ? <SelectField name="engagementId" label="Engagement (optional)" state={state} options={engagements} placeholder="None" /> : null}
      </div>

      <fieldset className="space-y-2">
        <legend className="mb-1 text-[12.5px] font-medium text-ink">Line items</legend>
        <div className="hidden grid-cols-[1fr_5rem_8rem] gap-2 text-[12px] text-muted sm:grid">
          <span>Description</span>
          <span>Qty</span>
          <span>Amount (USD)</span>
        </div>
        {Array.from({ length: rows }, (_, i) => (
          <LineItem key={i} index={i} state={state} />
        ))}
        {rows < MAX_ITEMS ? (
          <button type="button" onClick={() => setRows((r) => r + 1)} className={buttonClass("ghost", "px-2", "sm")}>
            + Add line
          </button>
        ) : null}
      </fieldset>

      <div className="space-y-1.5">
        <label htmlFor="note" className="block text-[12.5px] font-medium text-ink">
          Note to client (optional)
        </label>
        <textarea id="note" name="note" rows={2} maxLength={1000} defaultValue={state.values?.note} className={textareaClass} placeholder="Thank you for your business." />
        <p className="text-[12px] text-muted">Shown on the invoice. Don’t include Social Security or account numbers.</p>
      </div>

      <div className="flex flex-col gap-3 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[13px] text-muted">
          Total <span className="ml-1 text-[16px] font-semibold text-ink tabular">{usd.format(total / 100)}</span>
          <span className="block text-[12px]">PayPal will email the invoice to {clientEmail}.</span>
        </p>
        <SubmitButton pendingText="Sending to PayPal…">Create and send invoice</SubmitButton>
      </div>
    </form>
  );
}

function countRows(state: ActionState): number {
  let n = 0;
  for (let i = 0; i < MAX_ITEMS; i++) if (state.values?.[`item${i}Name`] || state.values?.[`item${i}Amount`]) n = i + 1;
  return n;
}

function LineItem({ index, state }: { index: number; state: ActionState }) {
  const names = { name: `item${index}Name`, qty: `item${index}Qty`, amount: `item${index}Amount` };
  const err = (k: string) => state.fieldErrors?.[k];
  const errors = [err(names.name), err(names.qty), err(names.amount)].flat().filter(Boolean);
  return (
    <div>
      <div className="grid grid-cols-[1fr_4rem_6.5rem] gap-2 sm:grid-cols-[1fr_5rem_8rem]">
        <input
          name={names.name}
          aria-label={`Line ${index + 1} description`}
          placeholder={index === 0 ? "Tax preparation – Form 1040" : "Description"}
          defaultValue={state.values?.[names.name]}
          maxLength={200}
          aria-invalid={err(names.name) ? true : undefined}
          className={inputClass}
        />
        <input
          name={names.qty}
          aria-label={`Line ${index + 1} quantity`}
          type="number"
          min={1}
          max={1000}
          step={1}
          defaultValue={state.values?.[names.qty] ?? "1"}
          aria-invalid={err(names.qty) ? true : undefined}
          className={cx(inputClass, "tabular")}
        />
        <input
          name={names.amount}
          aria-label={`Line ${index + 1} amount in US dollars`}
          inputMode="decimal"
          placeholder="0.00"
          defaultValue={state.values?.[names.amount]}
          aria-invalid={err(names.amount) ? true : undefined}
          className={cx(inputClass, "tabular text-right")}
        />
      </div>
      {errors.length ? <p className="mt-1 text-[12px] text-danger-ink">{errors.join(" ")}</p> : null}
    </div>
  );
}

/** Send / Refresh / Cancel buttons for one invoice row. */
export function InvoiceRowActions({ id, clientId, status, canCancel, firmId }: { id: string; clientId: string; status: string; canCancel: boolean; firmId?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionState | null>(null);

  const run = (op: "send" | "refresh" | "cancel") => {
    if (op === "cancel" && !window.confirm("Cancel this invoice? PayPal will tell the client it was cancelled, and it can no longer be paid.")) return;
    start(async () => {
      const r = await invoiceRowAction(id, clientId, op, firmId);
      setResult(r);
      router.refresh();
    });
  };

  const open = status === "sent" || status === "partially_paid";
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap justify-end gap-1">
        {status === "draft" ? (
          <button type="button" disabled={pending} onClick={() => run("send")} className={buttonClass("primary", undefined, "sm")}>
            Send
          </button>
        ) : null}
        {open ? (
          <button type="button" disabled={pending} onClick={() => run("refresh")} className={buttonClass("ghost", undefined, "sm")}>
            {pending ? "Checking…" : "Refresh"}
          </button>
        ) : null}
        {canCancel && (status === "draft" || status === "sent") ? (
          <button type="button" disabled={pending} onClick={() => run("cancel")} className={buttonClass("ghost", "text-danger-ink", "sm")}>
            Cancel
          </button>
        ) : null}
      </div>
      {result?.status === "error" ? (
        <p role="alert" className="max-w-xs text-right text-[12px] text-danger-ink">
          {result.message}
        </p>
      ) : null}
    </div>
  );
}

/* ───────── Subscriptions ───────── */

/** Staff form: sets up a monthly or yearly plan the client can subscribe to from the portal. */
export function NewSubscriptionForm({ clientId, clientEmail, firmId }: { clientId: string; clientEmail: string | null; firmId?: string }) {
  const [formKey, setFormKey] = useState(0);
  return <NewSubscriptionFormBody key={formKey} clientId={clientId} clientEmail={clientEmail} firmId={firmId} onReset={() => setFormKey((k) => k + 1)} />;
}

function NewSubscriptionFormBody({ clientId, clientEmail, firmId, onReset }: { clientId: string; clientEmail: string | null; firmId?: string; onReset: () => void }) {
  const [state, action] = useActionState(createSubscriptionAction.bind(null, clientId), idleState);
  if (state.status === "success") {
    return (
      <div className="space-y-3">
        <Alert tone="success">{state.message}</Alert>
        <button type="button" onClick={onReset} className={buttonClass("secondary")}>
          Set up another
        </button>
      </div>
    );
  }
  if (!clientEmail) return <Alert tone="warning">Add an email address to this client first.</Alert>;
  return (
    <form action={action} className="space-y-3" noValidate>
      {firmId ? <input type="hidden" name="firmId" value={firmId} /> : null}
      <FormMessage state={state} />
      {state.fieldErrors?._form ? <Alert tone="error">{state.fieldErrors._form.join(" ")}</Alert> : null}
      <TextField name="name" label="Plan name" required state={state} placeholder="Monthly bookkeeping" />
      <div className="grid grid-cols-2 gap-3">
        <TextField name="amountCents" label="Amount (USD)" required inputMode="text" state={state} placeholder="250.00" />
        <SelectField
          name="interval"
          label="Billed"
          required
          state={state}
          defaultValue="month"
          options={[
            { value: "month", label: "Monthly" },
            { value: "year", label: "Yearly" },
          ]}
        />
      </div>
      <p className="text-[12px] text-muted">The client gets a Subscribe button in their portal. Once they approve it in PayPal, they’re charged automatically each period until it’s cancelled.</p>
      <SubmitButton pendingText="Creating in PayPal…">Create subscription</SubmitButton>
    </form>
  );
}

export function SubscriptionRowActions({ id, clientId, status, canCancel, firmId }: { id: string; clientId: string; status: string; canCancel: boolean; firmId?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionState | null>(null);
  const live = status === "pending" || status === "active" || status === "suspended";
  if (!live) return null;
  const run = (op: "refresh" | "cancel") => {
    if (op === "cancel" && !window.confirm("Cancel this subscription? No further payments will be taken.")) return;
    start(async () => {
      setResult(await subscriptionRowAction(id, clientId, op, firmId));
      router.refresh();
    });
  };
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex justify-end gap-1">
        {status !== "pending" ? (
          <button type="button" disabled={pending} onClick={() => run("refresh")} className={buttonClass("ghost", undefined, "sm")}>
            {pending ? "Checking…" : "Refresh"}
          </button>
        ) : null}
        {canCancel ? (
          <button type="button" disabled={pending} onClick={() => run("cancel")} className={buttonClass("ghost", "text-danger-ink", "sm")}>
            Cancel
          </button>
        ) : null}
      </div>
      {result?.status === "error" ? (
        <p role="alert" className="max-w-xs text-right text-[12px] text-danger-ink">
          {result.message}
        </p>
      ) : null}
    </div>
  );
}

/** Portal: the client's Subscribe button. Redirects to PayPal to approve. */
export function SubscribeButton({ id, label }: { id: string; label: string }) {
  const [state, action] = useActionState(portalSubscribeAction.bind(null, id), idleState);
  return (
    <form action={action} className="flex flex-col items-stretch gap-1 sm:items-end">
      <SubmitButton pendingText="Opening PayPal…" className="min-h-10 px-4">
        Subscribe<span className="sr-only"> to {label}</span>
      </SubmitButton>
      {state.status === "error" ? (
        <p role="alert" className="max-w-xs text-[12px] text-danger-ink sm:text-right">
          {state.fieldErrors?._form?.join(" ") ?? state.message}
        </p>
      ) : null}
    </form>
  );
}
