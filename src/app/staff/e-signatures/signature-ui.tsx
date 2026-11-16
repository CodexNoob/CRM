"use client";

import { useActionState, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createSignatureDraftAction, sendSignatureAction, voidSignatureAction } from "@/app/actions/esignatures";
import { DataTable } from "@/components/data-table";
import { FormMessage, inputClass, SelectField, SubmitButton, TextField, textareaClass } from "@/components/form";
import { useToast } from "@/components/toast";
import { Badge, buttonClass, cx, type Tone } from "@/components/ui";
import { idleState } from "@/lib/action-state";
import { UploadDocumentButton } from "../documents/upload-document-button";

export const SIGNATURE_STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "neutral" },
  sent: { label: "Sent", tone: "info" },
  viewed: { label: "Viewed", tone: "info" },
  partially_signed: { label: "Partially signed", tone: "warn" },
  signed: { label: "Signed", tone: "good" },
  declined: { label: "Declined", tone: "danger" },
  expired: { label: "Expired", tone: "neutral" },
  voided: { label: "Voided", tone: "neutral" },
  failed: { label: "Failed", tone: "danger" },
};

export const DOCUMENT_TYPES: Record<string, string> = {
  engagement_letter: "Engagement letter",
  service_agreement: "Service agreement",
  tax_filing_authorization: "Tax filing authorization",
  client_consent: "Client consent form",
  disclosure: "Disclosure form",
  financial_information_authorization: "Financial information authorization",
  other: "Other",
};

export interface SignatureListRow {
  id: string;
  number: string;
  title: string;
  documentType: string;
  status: string;
  testMode: boolean;
  clientName: string;
  sentAt: string | null;
  expiresAt: string | null;
  completedAt: string | null;
  failureReason: string | null;
  signerCount: number;
  signedCount: number;
}

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—");

export function SignatureTable({ rows }: { rows: SignatureListRow[] }) {
  return (
    <DataTable
      label="Signature requests"
      rows={rows}
      getId={(r) => r.id}
      rowHref={(r) => `/staff/e-signatures/${r.id}`}
      initialSort={{ id: "sent", dir: "desc" }}
      search={{ placeholder: "Search title or client", text: (r) => `${r.number} ${r.title} ${r.clientName}` }}
      filters={[
        { id: "status", label: "Status", options: Object.entries(SIGNATURE_STATUS).map(([value, s]) => ({ value, label: s.label })), match: (r, v) => r.status === v },
        { id: "type", label: "Type", options: Object.entries(DOCUMENT_TYPES).map(([value, label]) => ({ value, label })), match: (r, v) => r.documentType === v },
      ]}
      columns={[
        { id: "title", header: "Request", sort: (r) => r.title, cell: (r) => <div><p className="font-medium text-ink">{r.title}</p><p className="text-[12px] text-muted">{r.number} · {DOCUMENT_TYPES[r.documentType] ?? r.documentType}</p>{r.status === "failed" ? <p className="mt-1 line-clamp-2 text-[12px] text-danger-ink">Dropbox Sign error: {r.failureReason ?? "No provider detail was returned."}</p> : null}</div> },
        { id: "client", header: "Client", sort: (r) => r.clientName, cell: (r) => r.clientName },
        { id: "status", header: "Status", sort: (r) => r.status, cell: (r) => <span className="flex flex-wrap gap-1"><Badge tone={SIGNATURE_STATUS[r.status]?.tone ?? "neutral"} dot>{SIGNATURE_STATUS[r.status]?.label ?? r.status}</Badge>{r.testMode && r.status !== "draft" ? <Badge tone="warn">Test</Badge> : null}</span> },
        { id: "signers", header: "Signed", sort: (r) => r.signedCount, cell: (r) => <span className="tabular">{r.signedCount} / {r.signerCount}</span> },
        { id: "sent", header: "Sent", sort: (r) => r.sentAt, cell: (r) => day(r.sentAt), hideBelow: "md" },
        { id: "expires", header: "Expires", sort: (r) => r.expiresAt, cell: (r) => day(r.expiresAt), hideBelow: "lg" },
        { id: "completed", header: "Completed", sort: (r) => r.completedAt, cell: (r) => day(r.completedAt), hideBelow: "lg" },
      ]}
      empty={{ title: "No signature requests yet" }}
    />
  );
}

/** New request: document → client/engagement → signers & order → expiration → review (draft). Sending is a separate step. */
export function NewSignatureForm({
  clients,
  documents,
  engagements,
  canUpload,
}: {
  clients: { id: string; name: string }[];
  documents: { id: string; clientId: string; name: string }[];
  engagements: { id: string; clientId: string; title: string }[];
  canUpload: boolean;
}) {
  const [state, action] = useActionState(createSignatureDraftAction, idleState);
  const [clientId, setClientId] = useState(state.values?.clientId ?? "");
  const [signers, setSigners] = useState(1);
  const docs = useMemo(() => documents.filter((d) => d.clientId === clientId), [documents, clientId]);
  const engs = useMemo(() => engagements.filter((e) => e.clientId === clientId), [engagements, clientId]);
  const err = (k: string) => state.fieldErrors?.[k]?.join(" ");

  return (
    <form action={action} className="space-y-5" noValidate>
      <FormMessage state={state} />
      {err("_form") ? <p role="alert" className="text-[13px] text-danger-ink">{err("_form")}</p> : null}
      <section className="space-y-3">
        <h2 className="text-[13px] font-semibold">1. Client and document</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="clientId" className="block text-[12.5px] font-medium">Client <span className="text-danger" aria-hidden>*</span></label>
            <select id="clientId" name="clientId" value={clientId} onChange={(e) => setClientId(e.target.value)} className={inputClass} aria-invalid={err("clientId") ? true : undefined}>
              <option value="">Choose a client</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {err("clientId") ? <p className="text-[12px] text-danger-ink">{err("clientId")}</p> : null}
          </div>
          <div className="space-y-1.5">
            <label htmlFor="documentId" className="block text-[12.5px] font-medium">Document to sign <span className="text-danger" aria-hidden>*</span></label>
            <select id="documentId" name="documentId" defaultValue={state.values?.documentId} key={clientId} className={inputClass} disabled={!clientId || !docs.length} aria-invalid={err("documentId") && (!clientId || docs.length > 0) ? true : undefined}>
              <option value="">{clientId ? (docs.length ? "Choose a PDF or Word document" : "Upload a PDF or Word document to this client first") : "Choose a client first"}</option>
              {docs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            {(!clientId || docs.length > 0) && err("documentId") ? <p className="text-[12px] text-danger-ink">{err("documentId")}</p> : null}
            {clientId && !docs.length ? (
              <div className="space-y-2 rounded-md border border-line bg-subtle p-3">
                <p className="text-[12px] text-muted">This client has no signable PDF or Word document yet. Upload one to continue. It will remain internal unless you choose to share it.</p>
                {canUpload ? (
                  <UploadDocumentButton key={clientId} clients={clients} defaultClientId={clientId} />
                ) : (
                  <p className="text-[12px] text-muted">Ask a staff member with document-upload access to upload it for this client.</p>
                )}
              </div>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <label htmlFor="engagementId" className="block text-[12.5px] font-medium">Engagement (optional)</label>
            <select id="engagementId" name="engagementId" key={`e-${clientId}`} defaultValue={state.values?.engagementId} className={inputClass} disabled={!clientId}>
              <option value="">None</option>
              {engs.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
            </select>
          </div>
          <SelectField name="documentType" label="Document type" state={state} defaultValue="engagement_letter" options={Object.entries(DOCUMENT_TYPES).map(([value, label]) => ({ value, label }))} />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-[13px] font-semibold">2. Request details</h2>
        <TextField name="title" label="Title" required state={state} placeholder="2026 engagement letter" />
        <div className="space-y-1.5">
          <label htmlFor="message" className="block text-[12.5px] font-medium">Message to signers (optional)</label>
          <textarea id="message" name="message" rows={2} maxLength={2000} defaultValue={state.values?.message} className={textareaClass} />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-[13px] font-semibold">3. Signers and order</h2>
        {err("signers") ? <p role="alert" className="text-[12px] text-danger-ink">{err("signers")}</p> : null}
        {Array.from({ length: signers }, (_, i) => (
          <div key={i} className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_1fr_8rem_4.5rem]">
            <input name={`signer${i}Name`} aria-label={`Signer ${i + 1} name`} placeholder="Full name" defaultValue={state.values?.[`signer${i}Name`]} className={inputClass} />
            <input name={`signer${i}Email`} type="email" aria-label={`Signer ${i + 1} email`} placeholder="Email" defaultValue={state.values?.[`signer${i}Email`]} className={inputClass} />
            <input name={`signer${i}Role`} aria-label={`Signer ${i + 1} role`} placeholder="Role (e.g. Taxpayer)" defaultValue={state.values?.[`signer${i}Role`]} className={inputClass} />
            <input name={`signer${i}Order`} type="number" min={1} max={10} aria-label={`Signer ${i + 1} signing order`} defaultValue={state.values?.[`signer${i}Order`] ?? String(i + 1)} className={cx(inputClass, "tabular")} />
          </div>
        ))}
        {signers < 10 ? <button type="button" onClick={() => setSigners((n) => n + 1)} className={buttonClass("ghost", "px-2", "sm")}>+ Add signer</button> : null}
        <p className="text-[12px] text-muted">Signers with the same order number sign in parallel; lower numbers sign first.</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-[13px] font-semibold">4. Expiration</h2>
        <div className="max-w-xs"><TextField name="expiresInDays" label="Expires after (days, optional)" inputMode="numeric" state={state} placeholder="30" /></div>
      </section>

      <div className="border-t border-line pt-4">
        {(!clientId || docs.length > 0) ? (
          <>
            <SubmitButton pendingText="Saving…">Save draft and review</SubmitButton>
            <p className="mt-2 text-[12px] text-muted">Nothing is sent yet — you’ll review the request and send it from the next page.</p>
          </>
        ) : null}
      </div>
    </form>
  );
}

export function SignatureControls({ id, canSend, canVoid, sendLabel, testMode }: { id: string; canSend: boolean; canVoid: boolean; sendLabel: string; testMode: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<import("@/lib/action-state").ActionState>, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    start(async () => {
      toast.fromState(await fn());
      router.refresh();
    });
  };
  if (!canSend && !canVoid) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {canSend ? (
        <button type="button" disabled={pending} onClick={() => run(() => sendSignatureAction(id), testMode
          ? "Send this test request through Dropbox Sign? It is not legally binding."
          : "Send this LIVE request through Dropbox Sign? Signers will receive an invitation and the signatures may be legally binding.")} className={buttonClass("primary")}>
          {pending ? "Sending…" : sendLabel}
        </button>
      ) : null}
      {canVoid ? (
        <button type="button" disabled={pending} onClick={() => run(() => voidSignatureAction(id), "Void this request? Signers will no longer be able to sign it.")} className={buttonClass("secondary", "text-danger-ink")}>
          Void request
        </button>
      ) : null}
    </div>
  );
}
