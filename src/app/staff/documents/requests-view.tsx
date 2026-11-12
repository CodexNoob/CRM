"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import { Ban, ClipboardList, Plus, Send, Trash2 } from "lucide-react";
import { cancelDocumentRequestAction, createDocumentRequestAction, sendDocumentRequestAction } from "@/app/actions/documents";
import { DataTable } from "@/components/data-table";
import { Dialog } from "@/components/dialog";
import { FormMessage, SubmitButton, inputClass, textareaClass } from "@/components/form";
import { useToast } from "@/components/toast";
import { Badge, buttonClass } from "@/components/ui";
import { idleState, type ActionState } from "@/lib/action-state";
import { DOCUMENT_CATEGORY_LABELS, recordRequestNumber, REQUEST_STATUS_LABELS, REQUEST_STATUS_TONE } from "@/services/document-labels";

export interface RequestRowView {
  id: string;
  requestNumber: number | null;
  title: string;
  clientId: string;
  clientName: string;
  status: keyof typeof REQUEST_STATUS_LABELS;
  dueDate: string | null;
  total: number;
  done: number;
  itemCount: number;
  createdAt: string;
}

const dateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const fmtDate = (iso: string | null) => (iso ? dateFmt.format(new Date(`${iso}T00:00:00Z`)) : "—");

export function RequestsTable({ rows, canRequest }: { rows: RequestRowView[]; canRequest: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const run = async (p: Promise<ActionState>) => {
    toast.fromState(await p);
    router.refresh();
  };
  return (
    <DataTable
      label="Document requests"
      rows={rows}
      getId={(r) => r.id}
      rowHref={(r) => `/staff/documents/requests/${r.id}`}
      initialSort={{ id: "created", dir: "desc" }}
      search={{ placeholder: "Search requests", text: (r) => `${r.title} ${r.clientName}` }}
      filters={[
        { id: "status", label: "Status", options: Object.entries(REQUEST_STATUS_LABELS).map(([value, label]) => ({ value, label })), match: (r, v) => r.status === v },
      ]}
      columns={[
        {
          id: "title",
          header: "Request",
          sort: (r) => r.title,
          cell: (r) => (
            <div className="min-w-0">
              <Link href={`/staff/documents/requests/${r.id}`} className="block truncate font-medium text-ink hover:underline">{r.title}</Link>
              <span className="text-[12px] text-muted">{recordRequestNumber(r.requestNumber)} · {r.itemCount} item{r.itemCount === 1 ? "" : "s"}</span>
            </div>
          ),
        },
        { id: "client", header: "Client", sort: (r) => r.clientName, hideBelow: "md", cell: (r) => <Link href={`/staff/clients/${r.clientId}?tab=documents`} className="hover:underline">{r.clientName}</Link> },
        { id: "status", header: "Status", sort: (r) => r.status, cell: (r) => <Badge tone={REQUEST_STATUS_TONE[r.status]} dot>{REQUEST_STATUS_LABELS[r.status]}</Badge> },
        {
          id: "progress",
          header: "Progress",
          sort: (r) => (r.total ? r.done / r.total : 0),
          hideBelow: "sm",
          cell: (r) => (
            <div className="flex min-w-24 items-center gap-2">
              <div className="h-1.5 flex-1 rounded-full bg-subtle" aria-hidden>
                <div className="h-1.5 rounded-full bg-success" style={{ width: `${r.total ? Math.round((r.done / r.total) * 100) : 0}%` }} />
              </div>
              <span className="tabular text-[12px] text-muted">{r.done}/{r.total}</span>
            </div>
          ),
        },
        { id: "due", header: "Due", sort: (r) => r.dueDate ?? "", hideBelow: "md", cell: (r) => <span className={r.status === "overdue" ? "font-medium text-danger-ink" : "text-muted"}>{fmtDate(r.dueDate)}</span> },
        { id: "created", header: "Created", sort: (r) => r.createdAt, align: "right", hideBelow: "lg", cell: (r) => <span className="text-[12px] text-muted">{dateFmt.format(new Date(r.createdAt))}</span> },
      ]}
      rowActions={(r) => [
        { label: "Open request", href: `/staff/documents/requests/${r.id}` },
        ...(canRequest && r.status === "draft" ? [{ label: "Send to client", icon: <Send />, onSelect: () => void run(sendDocumentRequestAction(r.id)) }] : []),
        ...(canRequest && r.status !== "cancelled" && r.status !== "fulfilled"
          ? [{ type: "separator" as const }, { label: "Cancel request", icon: <Ban />, danger: true, onSelect: () => { if (window.confirm(`Cancel “${r.title}”? The client will no longer see it.`)) void run(cancelDocumentRequestAction(r.id)); } }]
          : []),
      ]}
      empty={{ title: "No document requests yet", body: "Ask a client for documents; they upload each one from their portal.", icon: <ClipboardList /> }}
    />
  );
}

type ItemDraft = { key: number; title: string; category: string; required: boolean; description: string };

/** "New request" dialog with repeatable item rows. */
export function CreateRequestButton({ clients, defaultClientId }: { clients: { id: string; name: string }[]; defaultClientId?: string }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ItemDraft[]>([{ key: 1, title: "", category: "other", required: true, description: "" }]);
  const router = useRouter();
  const toast = useToast();
  const [state, action] = useActionState(async (prev: ActionState, fd: FormData) => {
    const next = await createDocumentRequestAction(prev, fd);
    if (next.status === "success") {
      toast.fromState(next);
      setOpen(false);
      setItems([{ key: Date.now(), title: "", category: "other", required: true, description: "" }]);
      router.refresh();
    }
    return next;
  }, idleState);
  const update = (key: number, patch: Partial<ItemDraft>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...patch } : i)));

  return (
    <>
      <button type="button" className={buttonClass("secondary")} onClick={() => setOpen(true)}>
        <ClipboardList /> Request documents
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Request documents from a client" description="The client sees the request in their portal once it’s sent. No email is sent." size="lg">
        <form action={action} className="space-y-3" noValidate>
          <FormMessage state={state} />
          {state.fieldErrors?.items ? <p className="text-[12px] text-danger-ink">{state.fieldErrors.items.join(" ")}</p> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <label htmlFor="rq-title" className="block text-[12.5px] font-medium text-ink">Request title</label>
              <input id="rq-title" name="title" required maxLength={200} className={inputClass} placeholder="2026 Annual Tax Preparation Documents" />
              {state.fieldErrors?.title ? <p className="text-[12px] text-danger-ink">{state.fieldErrors.title.join(" ")}</p> : null}
            </div>
            <div className="space-y-1.5">
              <label htmlFor="rq-client" className="block text-[12.5px] font-medium text-ink">Client</label>
              <select id="rq-client" name="clientId" defaultValue={defaultClientId ?? ""} className={inputClass} required>
                <option value="">Choose a client…</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              {state.fieldErrors?.clientId ? <p className="text-[12px] text-danger-ink">{state.fieldErrors.clientId.join(" ")}</p> : null}
            </div>
            <div className="space-y-1.5">
              <label htmlFor="rq-due" className="block text-[12.5px] font-medium text-ink">Due date (optional)</label>
              <input id="rq-due" name="dueDate" type="date" className={inputClass} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <label htmlFor="rq-desc" className="block text-[12.5px] font-medium text-ink">Message to the client (optional)</label>
              <textarea id="rq-desc" name="description" rows={2} maxLength={2000} className={textareaClass} placeholder="Please don’t include Social Security numbers in file names." />
            </div>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-[12.5px] font-medium text-ink">Documents requested</legend>
            {items.map((it, i) => (
              <div key={it.key} className="grid gap-2 rounded-md border border-line p-2.5 sm:grid-cols-[1fr_12rem_auto_auto] sm:items-center">
                <input name="item_title" aria-label={`Document ${i + 1}`} value={it.title} onChange={(e) => update(it.key, { title: e.target.value })} maxLength={200} className={inputClass} placeholder="e.g. Bank statements (Jan–Dec)" />
                <select name="item_category" aria-label={`Category for document ${i + 1}`} value={it.category} onChange={(e) => update(it.key, { category: e.target.value })} className={inputClass}>
                  {Object.entries(DOCUMENT_CATEGORY_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
                <label className="flex items-center gap-1.5 text-[12.5px] text-ink">
                  <input type="checkbox" name="item_required" value={String(i)} checked={it.required} onChange={(e) => update(it.key, { required: e.target.checked })} className="size-3.5 accent-brand" />
                  Required
                </label>
                <input type="hidden" name="item_description" value={it.description} />
                <button type="button" aria-label={`Remove document ${i + 1}`} disabled={items.length === 1} onClick={() => setItems((l) => l.filter((x) => x.key !== it.key))} className={buttonClass("ghost", "px-2", "sm")}>
                  <Trash2 />
                </button>
              </div>
            ))}
            <button type="button" className={buttonClass("ghost", undefined, "sm")} onClick={() => setItems((l) => [...l, { key: Date.now(), title: "", category: "other", required: true, description: "" }])} disabled={items.length >= 50}>
              <Plus /> Add document
            </button>
          </fieldset>

          <label className="flex items-center gap-2 text-[13px] text-ink">
            <input type="checkbox" name="send" defaultChecked className="size-3.5 accent-brand" />
            Send to the client now (otherwise save as a draft)
          </label>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className={buttonClass("secondary")} onClick={() => setOpen(false)}>Cancel</button>
            <SubmitButton pendingText="Saving…">Create request</SubmitButton>
          </div>
        </form>
      </Dialog>
    </>
  );
}

/** Send / cancel buttons on the request detail page. */
export function RequestActions({ id, status, canRequest }: { id: string; status: string; canRequest: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const run = async (p: Promise<ActionState>) => {
    toast.fromState(await p);
    router.refresh();
  };
  if (!canRequest) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {status === "draft" ? (
        <button type="button" className={buttonClass("primary")} onClick={() => void run(sendDocumentRequestAction(id))}>
          <Send /> Send to client
        </button>
      ) : null}
      {status !== "cancelled" && status !== "fulfilled" ? (
        <button type="button" className={buttonClass("secondary", "text-danger-ink")} onClick={() => { if (window.confirm("Cancel this request? The client will no longer see it.")) void run(cancelDocumentRequestAction(id)); }}>
          <Ban /> Cancel request
        </button>
      ) : null}
    </div>
  );
}
