"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Upload } from "lucide-react";
import { staffDocumentUploadAction } from "@/app/actions/documents";
import { Dialog } from "@/components/dialog";
import { FormMessage, SubmitButton, inputClass } from "@/components/form";
import { useToast } from "@/components/toast";
import { buttonClass } from "@/components/ui";
import { idleState, type ActionState } from "@/lib/action-state";
import { ACCEPT_ATTRIBUTE } from "@/lib/file-rules";
import { DOCUMENT_CATEGORY_LABELS } from "@/services/document-labels";

const subscribeToNothing = () => () => {};
const getPortalRoot = () => document.body;
const getServerPortalRoot = () => null;

/** Reused by the Documents page and the signature-request form. */
export function UploadDocumentButton({ clients, defaultClientId }: { clients: { id: string; name: string }[]; defaultClientId?: string }) {
  const [open, setOpen] = useState(false);
  const portalRoot = useSyncExternalStore<HTMLElement | null>(subscribeToNothing, getPortalRoot, getServerPortalRoot);
  const router = useRouter();
  const toast = useToast();
  const [state, action] = useActionState(async (prev: ActionState, fd: FormData) => {
    const next = await staffDocumentUploadAction(prev, fd);
    if (next.status === "success") {
      toast.fromState(next);
      setOpen(false);
      router.refresh();
    }
    return next;
  }, idleState);
  return (
    <>
      <button type="button" className={buttonClass("primary")} onClick={() => setOpen(true)}>
        <Upload /> Upload document
      </button>
      {portalRoot ? createPortal(
        <Dialog open={open} onClose={() => setOpen(false)} title="Upload a document" description="Files are stored privately. Staff uploads are internal only unless you choose otherwise.">
        <form action={action} className="space-y-3" noValidate>
          <FormMessage state={state} />
          <div className="space-y-1.5">
            <label htmlFor="up-client" className="block text-[12.5px] font-medium text-ink">Client</label>
            <select id="up-client" name="clientId" defaultValue={defaultClientId ?? ""} className={inputClass} required>
              <option value="">Choose a client…</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            {state.fieldErrors?.clientId ? <p className="text-[12px] text-danger-ink">{state.fieldErrors.clientId.join(" ")}</p> : null}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="up-category" className="block text-[12.5px] font-medium text-ink">Category</label>
              <select id="up-category" name="category" defaultValue="other" className={inputClass}>
                {Object.entries(DOCUMENT_CATEGORY_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="up-vis" className="block text-[12.5px] font-medium text-ink">Visibility</label>
              <select id="up-vis" name="visibility" defaultValue="internal_only" className={inputClass}>
                <option value="internal_only">Internal only (working papers)</option>
                <option value="shared_with_client">Share with the client</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="up-title" className="block text-[12.5px] font-medium text-ink">Title (optional)</label>
              <input id="up-title" name="title" maxLength={200} className={inputClass} placeholder="Defaults to the file name" />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="up-year" className="block text-[12.5px] font-medium text-ink">Tax year (optional)</label>
              <input id="up-year" name="taxYear" inputMode="numeric" maxLength={4} className={inputClass} placeholder="2026" />
            </div>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="up-file" className="block text-[12.5px] font-medium text-ink">File</label>
            <input id="up-file" name="file" type="file" required accept={ACCEPT_ATTRIBUTE} className="block w-full text-[13px]" />
            <p className="text-[12px] text-muted">PDF, images, Excel, Word, CSV or text · up to 25 MB. Links to engagements and tax records can be added on the document page.</p>
            {state.fieldErrors?.file ? <p className="text-[12px] text-danger-ink">{state.fieldErrors.file.join(" ")}</p> : null}
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className={buttonClass("secondary")} onClick={() => setOpen(false)}>Cancel</button>
            <SubmitButton pendingText="Uploading…"><Upload /> Upload</SubmitButton>
          </div>
        </form>
        </Dialog>,
        portalRoot,
      ) : null}
    </>
  );
}
