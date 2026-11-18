"use client";

import { useActionState, useState } from "react";
import { Plus } from "lucide-react";
import {
  approveTaxReturnAction,
  createTaxDocumentTemplateAction,
  createTaxPreparationCaseAction,
  createTaxReturnFromPreparationAction,
  recordTaxAuthorityResponseAction,
  recordTaxAuthorizationAction,
  recordTaxFilingAction,
  requestTaxReturnChangesAction,
  setTaxPreparationStatusAction,
  startTaxReturnReviewAction,
  submitTaxReturnForReviewAction,
  updateTaxChecklistItemAction,
  updateTaxReturnPreparationDataAction,
} from "@/app/actions/tax";
import { staffUploadAction } from "@/app/actions/phase1";
import { Dialog } from "@/components/dialog";
import { FormMessage, SelectField, SubmitButton, TextField } from "@/components/form";
import { buttonClass } from "@/components/ui";
import { idleState } from "@/lib/action-state";
import type { TaxChecklistStatus, TaxPreparationStatus } from "@/db/schema";
import { TAX_CHECKLIST_STATUS_LABELS, TAX_PREPARATION_STATUS_LABELS } from "@/lib/labels";

const serviceOptions = [
  { value: "individual_tax", label: "Individual tax return" },
  { value: "business_tax", label: "Business tax return" },
];

export function CreateTaxPreparationForm({
  clients,
  engagements,
  staff,
  defaultTaxYear,
}: {
  clients: { id: string; name: string }[];
  engagements: { id: string; clientId: string; title: string; clientName: string; serviceType: string }[];
  staff: { id: string; name: string }[];
  defaultTaxYear: number;
}) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(createTaxPreparationCaseAction, idleState);
  return (
    <>
      <button type="button" className={buttonClass("primary")} onClick={() => setOpen(true)}>
        <Plus /> Create preparation case
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="New preparation case"
        description="Enter the tax return details and assign a preparer."
        size="lg"
      >
        <form action={action} className="space-y-3">
          <FormMessage state={state} />
          <SelectField name="clientId" label="Client" required state={state} options={clients.map((c) => ({ value: c.id, label: c.name }))} placeholder="Choose a client" />
          <SelectField name="engagementId" label="Related tax engagement" state={state} options={engagements.map((e) => ({ value: e.id, label: `${e.clientName} · ${e.title}` }))} placeholder="No engagement" hint="If selected, the engagement must match the selected client and tax service." />
          <TextField name="taxYear" label="Tax year" type="number" required state={state} defaultValue={String(defaultTaxYear)} />
          <TextField name="taxPeriod" label="Tax period" required state={state} defaultValue="annual" hint="For example, annual or Q1 2026." />
          <TextField name="jurisdiction" label="Jurisdiction" required state={state} placeholder="Enter the applicable jurisdiction" />
          <TextField name="taxFormType" label="Tax form" required state={state} placeholder="Enter the applicable form" />
          <SelectField name="serviceType" label="Tax service" required state={state} options={serviceOptions} />
          <SelectField name="filingType" label="Filing type" required state={state} defaultValue="original" options={[{ value: "original", label: "Original" }, { value: "amended", label: "Amended" }]} />
          <TextField name="returnSequence" label="Return sequence" type="number" required state={state} defaultValue="1" />
          <SelectField name="preparerId" label="Preparer" required state={state} options={staff.map((s) => ({ value: s.id, label: s.name }))} placeholder="Choose a preparer" />
          <SelectField name="reviewerId" label="Reviewer" state={state} options={staff.map((s) => ({ value: s.id, label: s.name }))} placeholder="Choose later" />
          <TextField name="dueDate" label="Filing deadline" type="date" state={state} hint="Use a verified deadline; the system does not invent statutory due dates." />
          <TextField name="internalNotes" label="Internal notes" state={state} />
          <div className="flex justify-end gap-2 border-t border-line pt-3">
            <button type="button" className={buttonClass("secondary")} onClick={() => setOpen(false)}>
              Cancel
            </button>
            <SubmitButton pendingText="Creating…">Create preparation case</SubmitButton>
          </div>
        </form>
      </Dialog>
    </>
  );
}

export function CreateTaxDocumentTemplateForm() {
  const [state, action] = useActionState(createTaxDocumentTemplateAction, idleState);
  return (
    <form action={action} className="grid gap-3 md:grid-cols-2">
      <FormMessage state={state} />
      <TextField name="name" label="Document requirement" required state={state} placeholder="Income statements" />
      <SelectField name="serviceType" label="Tax service" required state={state} options={serviceOptions} />
      <SelectField name="taxpayerType" label="Taxpayer type" state={state} placeholder="All types" options={[
        { value: "individual", label: "Individual" },
        { value: "household", label: "Household" },
        { value: "business", label: "Business" },
      ]} />
      <TextField name="jurisdiction" label="Jurisdiction" state={state} hint="Blank applies to all; use an exact jurisdiction match." />
      <TextField name="taxYear" label="Tax year" type="number" state={state} hint="Blank applies to all years." />
      <TextField name="description" label="Description" state={state} />
      <label className="flex items-center gap-2 text-[13px] text-ink">
        <input type="checkbox" name="required" defaultChecked className="size-4 accent-brand" />
        Required
      </label>
      <div className="md:col-span-2"><SubmitButton variant="secondary">Add checklist requirement</SubmitButton></div>
    </form>
  );
}

export function TaxPreparationStatusForm({ id, status }: { id: string; status: TaxPreparationStatus }) {
  const [state, action] = useActionState(setTaxPreparationStatusAction.bind(null, id), idleState);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <SelectField name="status" label="Preparation status" required state={state} defaultValue={status} options={Object.entries(TAX_PREPARATION_STATUS_LABELS).map(([value, label]) => ({ value, label }))} />
      <SubmitButton variant="secondary">Update status</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

export function TaxChecklistItemForm({
  id,
  status,
  documentId,
  notes,
  documents,
}: {
  id: string;
  status: TaxChecklistStatus;
  documentId: string | null;
  notes: string | null;
  documents: { id: string; fileName: string }[];
}) {
  const [state, action] = useActionState(updateTaxChecklistItemAction.bind(null, id), idleState);
  return (
    <form action={action} className="grid gap-2 sm:grid-cols-[10rem_1fr_1fr_auto] sm:items-end">
      <SelectField name="status" label="Status" required state={state} defaultValue={status} options={Object.entries(TAX_CHECKLIST_STATUS_LABELS).map(([value, label]) => ({ value, label }))} />
      <SelectField name="documentId" label="Supporting document" state={state} defaultValue={documentId ?? ""} options={documents.map((d) => ({ value: d.id, label: d.fileName }))} placeholder="Choose an uploaded file" />
      <TextField name="notes" label="Notes / reason" state={state} defaultValue={notes} />
      <SubmitButton variant="secondary">Save</SubmitButton>
      <div className="sm:col-span-4"><FormMessage state={state} /></div>
    </form>
  );
}

export function CreateReturnFromPreparationButton({ id }: { id: string }) {
  const [state, action] = useActionState(createTaxReturnFromPreparationAction.bind(null, id), idleState);
  return (
    <form action={action}>
      <SubmitButton>Create linked tax return</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

export function TaxReturnPreparationDataForm({
  id,
  refundAmountCents,
  amountOwedCents,
  internalNotes,
}: {
  id: string;
  refundAmountCents: number | null;
  amountOwedCents: number | null;
  internalNotes: string | null;
}) {
  const [state, action] = useActionState(updateTaxReturnPreparationDataAction.bind(null, id), idleState);
  return (
    <form action={action} className="mt-5 space-y-3 border-t border-line pt-4">
      <p className="text-xs text-muted">Enter values calculated in approved tax software; this CRM does not calculate tax liability.</p>
      <TextField name="refundAmount" label="Refund amount" type="number" step="0.01" min="0" state={state} defaultValue={refundAmountCents === null ? "" : (refundAmountCents / 100).toFixed(2)} />
      <TextField name="amountOwed" label="Amount owed" type="number" step="0.01" min="0" state={state} defaultValue={amountOwedCents === null ? "" : (amountOwedCents / 100).toFixed(2)} />
      <TextField name="internalNotes" label="Internal preparation notes" state={state} defaultValue={internalNotes ?? ""} />
      <SubmitButton variant="secondary">Save preparation details</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

export function TaxDocumentUploadForm({ clientId, engagementId }: { clientId: string; engagementId: string | null }) {
  const [state, action] = useActionState(staffUploadAction.bind(null, clientId), idleState);
  return (
    <form action={action} className="space-y-3">
      {engagementId ? <input type="hidden" name="engagementId" value={engagementId} /> : null}
      <label className="block space-y-1.5 text-[12.5px] font-medium text-ink">
        <span>Choose a file</span>
        <input type="file" name="file" required className="block w-full text-[13px] text-muted file:mr-3 file:rounded-md file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:text-ink" />
      </label>
      <p className="text-xs text-muted">Uploads are private to staff by default. Share a file only through the existing document sharing controls.</p>
      <SubmitButton variant="secondary">Upload document</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

export function TaxReturnWorkflowForms({
  id,
  status,
  authorizationStatus,
  reviewerCanAct,
  filingCanAct,
  today,
}: {
  id: string;
  status: string;
  authorizationStatus: string;
  reviewerCanAct: boolean;
  filingCanAct: boolean;
  today: string;
}) {
  const [submitState, submitAction] = useActionState(submitTaxReturnForReviewAction.bind(null, id), idleState);
  const [startReviewState, startReviewAction] = useActionState(startTaxReturnReviewAction.bind(null, id), idleState);
  const [changeState, changeAction] = useActionState(requestTaxReturnChangesAction.bind(null, id), idleState);
  const [approveState, approveAction] = useActionState(approveTaxReturnAction.bind(null, id), idleState);
  const [authorizationState, authorizationAction] = useActionState(recordTaxAuthorizationAction.bind(null, id), idleState);
  const [filingState, filingAction] = useActionState(recordTaxFilingAction.bind(null, id), idleState);
  const [responseState, responseAction] = useActionState(recordTaxAuthorityResponseAction.bind(null, id), idleState);

  return (
    <div className="space-y-5">
      {["in_preparation", "changes_required"].includes(status) ? (
        <form action={submitAction} className="space-y-2">
          <p className="text-[13px] text-muted">Submit only when preparation and required documents are complete.</p>
          <SubmitButton>Submit for review</SubmitButton><FormMessage state={submitState} />
        </form>
      ) : null}
      {reviewerCanAct && ["ready_for_review", "under_review", "rejected"].includes(status) ? (
        <div className="space-y-3 border-t border-line pt-4">
          {status === "ready_for_review" ? (
            <form action={startReviewAction} className="space-y-2">
              <SubmitButton variant="secondary">Start review</SubmitButton><FormMessage state={startReviewState} />
            </form>
          ) : null}
          <form action={changeAction} className="space-y-2">
            <TextField name="note" label="Correction request" required state={changeState} />
            <SubmitButton variant="secondary">Request corrections</SubmitButton><FormMessage state={changeState} />
          </form>
          {["ready_for_review", "under_review"].includes(status) ? (
            <form action={approveAction} className="space-y-2">
              <SubmitButton>Approve review</SubmitButton><FormMessage state={approveState} />
            </form>
          ) : null}
        </div>
      ) : null}
      {filingCanAct && status === "awaiting_client_approval" ? (
        <form action={authorizationAction} className="space-y-2 border-t border-line pt-4">
          <p className="text-[13px] text-muted">Record the client’s actual authorization outcome. This does not create an e-signature.</p>
          <SelectField name="outcome" label="Authorization outcome" required state={authorizationState} defaultValue="authorized" options={[
            { value: "authorized", label: "Authorized" },
            { value: "declined", label: "Declined" },
          ]} />
          <SubmitButton>Record authorization</SubmitButton><FormMessage state={authorizationState} />
        </form>
      ) : null}
      {filingCanAct && status === "approved" && authorizationStatus === "authorized" ? (
        <form action={filingAction} className="space-y-2 border-t border-line pt-4">
          <p className="text-[13px] text-muted">Manual filing record only. Enter the actual filing date and confirmation from the tax authority or filing provider.</p>
          <TextField name="filingDate" label="Actual filing date" type="date" required state={filingState} defaultValue={today} />
          <TextField name="submissionReference" label="Submission / confirmation reference" required state={filingState} />
          <SubmitButton>Record filing</SubmitButton><FormMessage state={filingState} />
        </form>
      ) : null}
      {filingCanAct && status === "filed" ? (
        <form action={responseAction} className="space-y-2 border-t border-line pt-4">
          <p className="text-[13px] text-muted">Record the verified response received from the tax authority. A filed return remains pending until this is recorded.</p>
          <SelectField name="outcome" label="Authority response" required state={responseState} options={[
            { value: "accepted", label: "Accepted" },
            { value: "rejected", label: "Rejected" },
          ]} />
          <TextField name="response" label="Response details" state={responseState} />
          <SubmitButton>Record authority response</SubmitButton><FormMessage state={responseState} />
        </form>
      ) : null}
    </div>
  );
}
