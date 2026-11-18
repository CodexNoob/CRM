"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState, useTransition } from "react";
import { Archive, CheckCircle2, Eye, EyeOff, FileSearch, RotateCcw, Upload, XCircle } from "lucide-react";
import {
  archiveDocumentByIdAction,
  reviewDocumentAction,
  setDocumentVisibilityAction,
  staffNewVersionAction,
  updateDocumentMetadataAction,
  waiveRequestItemAction,
} from "@/app/actions/documents";
import { Dialog } from "@/components/dialog";
import { FormMessage, SubmitButton, inputClass, textareaClass } from "@/components/form";
import { useToast } from "@/components/toast";
import { buttonClass } from "@/components/ui";
import type { DocumentStatus, DocumentVisibility } from "@/db/schema";
import { idleState, type ActionState } from "@/lib/action-state";
import { ACCEPT_ATTRIBUTE } from "@/lib/file-rules";
import { DOCUMENT_CATEGORY_LABELS } from "@/services/document-labels";
import type { DocPerms } from "./documents-view";

function useRun() {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  return {
    pending,
    run: (p: () => Promise<ActionState>) =>
      start(async () => {
        toast.fromState(await p());
        router.refresh();
      }),
  };
}

/** Review, sharing and archive buttons for one document (current version only). */
export function ReviewControls({ id, status, visibility, uploadedByClient, isCurrent, perms }: { id: string; status: DocumentStatus; visibility: DocumentVisibility; uploadedByClient: boolean; isCurrent: boolean; perms: DocPerms }) {
  const { pending, run } = useRun();
  const [reason, setReason] = useState<"reject" | "request_replacement" | null>(null);
  const [note, setNote] = useState("");
  if (!isCurrent) return <p className="text-[13px] text-muted">This is an older version. Review the current version instead.</p>;
  return (
    <div className="flex flex-wrap gap-2">
      {perms.review && status !== "under_review" && status !== "verified" ? (
        <button type="button" disabled={pending} className={buttonClass("secondary", undefined, "sm")} onClick={() => run(() => reviewDocumentAction(id, "start_review"))}>
          <FileSearch /> Start review
        </button>
      ) : null}
      {perms.verify && status !== "verified" ? (
        <button type="button" disabled={pending} className={buttonClass("primary", undefined, "sm")} onClick={() => run(() => reviewDocumentAction(id, "verify"))}>
          <CheckCircle2 /> Verify
        </button>
      ) : null}
      {perms.reject ? (
        <>
          <button type="button" disabled={pending} className={buttonClass("secondary", undefined, "sm")} onClick={() => setReason("request_replacement")}>
            <RotateCcw /> Request replacement
          </button>
          <button type="button" disabled={pending} className={buttonClass("secondary", "text-danger-ink", "sm")} onClick={() => setReason("reject")}>
            <XCircle /> Reject
          </button>
        </>
      ) : null}
      {perms.share && !uploadedByClient ? (
        visibility === "internal_only" ? (
          <button type="button" disabled={pending} className={buttonClass("secondary", undefined, "sm")} onClick={() => run(() => setDocumentVisibilityAction(id, "shared_with_client"))}>
            <Eye /> Share with client
          </button>
        ) : (
          <button type="button" disabled={pending} className={buttonClass("secondary", undefined, "sm")} onClick={() => run(() => setDocumentVisibilityAction(id, "internal_only"))}>
            <EyeOff /> Make internal only
          </button>
        )
      ) : null}
      {perms.archive ? (
        <button
          type="button"
          disabled={pending}
          className={buttonClass("ghost", "text-danger-ink", "sm")}
          onClick={() => {
            if (window.confirm("Archive this document? It will be hidden from staff lists and the client portal. The file is kept.")) run(() => archiveDocumentByIdAction(id));
          }}
        >
          <Archive /> Archive
        </button>
      ) : null}
      <Dialog
        open={!!reason}
        onClose={() => setReason(null)}
        title={reason === "reject" ? "Reject document" : "Request replacement"}
        description="The client sees this note next to the document."
        size="sm"
        footer={
          <>
            <button type="button" className={buttonClass("secondary")} onClick={() => setReason(null)}>Cancel</button>
            <button
              type="button"
              className={buttonClass("danger")}
              disabled={pending || !note.trim()}
              onClick={() => {
                const action = reason!;
                setReason(null);
                run(() => reviewDocumentAction(id, action, note.trim()));
                setNote("");
              }}
            >
              {reason === "reject" ? "Reject" : "Request replacement"}
            </button>
          </>
        }
      >
        <label htmlFor="rv-note" className="mb-1.5 block text-[12.5px] font-medium text-ink">Reason</label>
        <textarea id="rv-note" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} className={textareaClass} placeholder="Say what’s wrong and what to send instead." />
      </Dialog>
    </div>
  );
}

export interface MetadataView {
  title: string;
  category: string;
  description: string;
  internalNotes: string;
  taxYear: string;
  expirationDate: string;
  engagementId: string;
  taxPreparationCaseId: string;
  taxReturnId: string;
}

/** Edit metadata and links (engagement / tax case / tax return of the same client). */
export function MetadataForm({ id, initial, options }: { id: string; initial: MetadataView; options: { engagements: { id: string; label: string }[]; taxCases: { id: string; label: string }[]; taxReturns: { id: string; label: string }[] } }) {
  const [state, action] = useActionState(updateDocumentMetadataAction.bind(null, id), idleState);
  const toast = useToast();
  const router = useRouter();
  useEffect(() => {
    if (state.status === "success") {
      toast.fromState(state);
      router.refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  const v = (k: keyof MetadataView) => state.values?.[k] ?? initial[k];
  const err = (k: string) => state.fieldErrors?.[k]?.join(" ");
  const select = (name: keyof MetadataView, label: string, opts: { id: string; label: string }[]) => (
    <div className="space-y-1.5">
      <label htmlFor={`md-${name}`} className="block text-[12.5px] font-medium text-ink">{label}</label>
      <select id={`md-${name}`} name={name} defaultValue={v(name)} key={v(name)} className={inputClass}>
        <option value="">None</option>
        {opts.map((o) => (
          <option key={o.id} value={o.id}>{o.label}</option>
        ))}
      </select>
      {err(name) ? <p className="text-[12px] text-danger-ink">{err(name)}</p> : null}
    </div>
  );
  return (
    <form action={action} className="space-y-3" noValidate>
      <FormMessage state={state.status === "success" ? idleState : state} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <label htmlFor="md-title" className="block text-[12.5px] font-medium text-ink">Title</label>
          <input id="md-title" name="title" defaultValue={v("title")} key={`t${v("title")}`} maxLength={200} className={inputClass} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="md-category" className="block text-[12.5px] font-medium text-ink">Category</label>
          <select id="md-category" name="category" defaultValue={v("category")} key={`c${v("category")}`} className={inputClass}>
            {Object.entries(DOCUMENT_CATEGORY_LABELS).map(([val, l]) => (
              <option key={val} value={val}>{l}</option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label htmlFor="md-year" className="block text-[12.5px] font-medium text-ink">Tax year</label>
            <input id="md-year" name="taxYear" inputMode="numeric" defaultValue={v("taxYear")} key={`y${v("taxYear")}`} className={inputClass} />
            {err("taxYear") ? <p className="text-[12px] text-danger-ink">{err("taxYear")}</p> : null}
          </div>
          <div className="space-y-1.5">
            <label htmlFor="md-exp" className="block text-[12.5px] font-medium text-ink">Expires</label>
            <input id="md-exp" name="expirationDate" type="date" defaultValue={v("expirationDate")} key={`e${v("expirationDate")}`} className={inputClass} />
          </div>
        </div>
        {select("engagementId", "Engagement", options.engagements)}
        {select("taxPreparationCaseId", "Tax preparation case", options.taxCases)}
        {select("taxReturnId", "Tax return", options.taxReturns)}
        <div className="space-y-1.5 sm:col-span-2">
          <label htmlFor="md-desc" className="block text-[12.5px] font-medium text-ink">Description</label>
          <textarea id="md-desc" name="description" rows={2} maxLength={2000} defaultValue={v("description")} key={`d${v("description")}`} className={textareaClass} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <label htmlFor="md-notes" className="block text-[12.5px] font-medium text-ink">Internal notes <span className="font-normal text-muted">(staff only — never shown to the client)</span></label>
          <textarea id="md-notes" name="internalNotes" rows={3} maxLength={5000} defaultValue={v("internalNotes")} key={`n${v("internalNotes")}`} className={`${textareaClass} bg-warning-soft/40`} />
        </div>
      </div>
      <div className="flex justify-end">
        <SubmitButton pendingText="Saving…">Save details</SubmitButton>
      </div>
    </form>
  );
}

/** Upload a new version (the current one is kept in the history). */
export function NewVersionForm({ id }: { id: string }) {
  const [state, action] = useActionState(staffNewVersionAction.bind(null, id), idleState);
  const router = useRouter();
  const toast = useToast();
  useEffect(() => {
    if (state.status === "success") {
      toast.fromState(state);
      router.refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  return (
    <form action={action} className="space-y-2" noValidate>
      <FormMessage state={state.status === "success" ? idleState : state} />
      <input name="file" type="file" required accept={ACCEPT_ATTRIBUTE} aria-label="New version file" className="block w-full text-[13px]" />
      <SubmitButton pendingText="Uploading…" variant="secondary" size="sm">
        <Upload /> Upload new version
      </SubmitButton>
    </form>
  );
}

export function WaiveItemButton({ itemId }: { itemId: string }) {
  const { pending, run } = useRun();
  return (
    <button type="button" disabled={pending} className={buttonClass("ghost", undefined, "sm")} onClick={() => { if (window.confirm("Mark this document as not needed?")) run(() => waiveRequestItemAction(itemId)); }}>
      Not needed
    </button>
  );
}
