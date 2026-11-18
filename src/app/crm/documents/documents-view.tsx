"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Archive, CheckCircle2, Download, Eye, EyeOff, FileSearch, FileText, History, RotateCcw, XCircle } from "lucide-react";
import { archiveDocumentByIdAction, reviewDocumentAction, setDocumentVisibilityAction } from "@/app/actions/documents";
import { DataTable } from "@/components/data-table";
import { Dialog } from "@/components/dialog";
import { textareaClass } from "@/components/form";
import { useToast } from "@/components/toast";
import { Badge, buttonClass } from "@/components/ui";
import type { DocumentCategory, DocumentStatus, DocumentVisibility } from "@/db/schema";
import { type ActionState } from "@/lib/action-state";
import { formatBytes } from "@/lib/labels";
import { DOCUMENT_CATEGORY_LABELS, DOCUMENT_STATUS_LABELS, DOCUMENT_STATUS_TONE, DOCUMENT_VISIBILITY_LABELS, recordDocNumber } from "@/services/document-labels";

export interface StaffDocView {
  id: string;
  documentNumber: number | null;
  title: string | null;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  category: DocumentCategory;
  status: DocumentStatus;
  visibility: DocumentVisibility;
  versionNumber: number;
  clientId: string;
  clientName: string;
  engagementTitle: string | null;
  taxYear: number | null;
  uploadedByName: string | null;
  uploadedByClient: boolean;
  createdAt: string;
}

export interface DocPerms {
  upload: boolean;
  download: boolean;
  review: boolean;
  verify: boolean;
  reject: boolean;
  share: boolean;
  archive: boolean;
  edit: boolean;
  request: boolean;
}

const dateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
const PREVIEWABLE = new Set(["application/pdf", "image/png", "image/jpeg"]);

/** Reject / request-replacement reason prompt. */
function ReasonDialog({ open, title, onClose, onSubmit }: { open: boolean; title: string; onClose: () => void; onSubmit: (note: string) => Promise<void> }) {
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description="The client sees this note next to the document, so say clearly what to send."
      size="sm"
      footer={
        <>
          <button type="button" className={buttonClass("secondary")} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={buttonClass("danger")}
            disabled={pending || !note.trim()}
            onClick={() =>
              start(async () => {
                await onSubmit(note.trim());
                setNote("");
              })
            }
          >
            {pending ? "Saving…" : title}
          </button>
        </>
      }
    >
      <label htmlFor="review-note" className="mb-1.5 block text-[12.5px] font-medium text-ink">
        Reason
      </label>
      <textarea id="review-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} rows={3} className={textareaClass} placeholder="e.g. Pages 2 and 3 are missing — please send the full statement." />
    </Dialog>
  );
}

export function StaffDocumentsTable({ docs, perms }: { docs: StaffDocView[]; perms: DocPerms }) {
  const router = useRouter();
  const toast = useToast();
  const [reason, setReason] = useState<{ id: string; action: "reject" | "request_replacement" } | null>(null);
  const run = async (p: Promise<ActionState>) => {
    toast.fromState(await p);
    router.refresh();
  };

  return (
    <>
      <DataTable
        label="Documents"
        rows={docs}
        getId={(d) => d.id}
        rowHref={(d) => `/crm/documents/${d.id}`}
        initialSort={{ id: "added", dir: "desc" }}
        pageSize={25}
        search={{ placeholder: "Search this page", text: (d) => `${d.title ?? ""} ${d.fileName} ${d.clientName}` }}
        columns={[
          {
            id: "doc",
            header: "Document",
            sort: (d) => (d.title ?? d.fileName).toLowerCase(),
            cell: (d) => (
              <div className="flex min-w-0 items-center gap-2.5">
                <FileText className="size-4 shrink-0 text-faint" aria-hidden />
                <div className="min-w-0">
                  <Link href={`/crm/documents/${d.id}`} className="block truncate font-medium text-ink hover:text-brand hover:underline">
                    {d.title ?? d.fileName}
                  </Link>
                  <div className="truncate text-[12px] text-muted">
                    {recordDocNumber(d.documentNumber)}
                    {d.versionNumber > 1 ? ` · v${d.versionNumber}` : ""} · {d.fileName} · {formatBytes(d.sizeBytes)}
                  </div>
                </div>
              </div>
            ),
          },
          { id: "client", header: "Client", sort: (d) => d.clientName, hideBelow: "md", cell: (d) => <Link href={`/crm/clients/${d.clientId}?tab=documents`} className="text-ink hover:underline">{d.clientName}</Link> },
          { id: "category", header: "Category", sort: (d) => d.category, hideBelow: "lg", cell: (d) => <span className="text-muted">{DOCUMENT_CATEGORY_LABELS[d.category]}</span> },
          { id: "status", header: "Status", sort: (d) => d.status, cell: (d) => <Badge tone={DOCUMENT_STATUS_TONE[d.status]} dot>{DOCUMENT_STATUS_LABELS[d.status]}</Badge> },
          {
            id: "vis",
            header: "Visibility",
            sort: (d) => d.visibility,
            hideBelow: "sm",
            cell: (d) => <Badge tone={d.visibility === "internal_only" ? "neutral" : "brand"}>{DOCUMENT_VISIBILITY_LABELS[d.visibility]}</Badge>,
          },
          { id: "eng", header: "Engagement", sort: (d) => d.engagementTitle ?? "", hideBelow: "lg", cell: (d) => <span className="text-muted">{d.engagementTitle ?? "—"}{d.taxYear ? ` · ${d.taxYear}` : ""}</span> },
          {
            id: "added",
            header: "Uploaded",
            sort: (d) => d.createdAt,
            align: "right",
            cell: (d) => (
              <span className="whitespace-nowrap text-[12px] text-muted">
                {dateFmt.format(new Date(d.createdAt))}
                <span className="block">{d.uploadedByName ?? "—"}{d.uploadedByClient ? " (client)" : ""}</span>
              </span>
            ),
          },
        ]}
        rowActions={(d) => [
          { label: "Open details", icon: <History />, href: `/crm/documents/${d.id}` },
          ...(perms.download
            ? [
                ...(PREVIEWABLE.has(d.contentType) ? [{ label: "Preview", icon: <Eye />, href: `/api/documents/${d.id}?inline=1` }] : []),
                { label: "Download", icon: <Download />, href: `/api/documents/${d.id}` },
              ]
            : []),
          ...(perms.review && d.status !== "under_review" && d.status !== "verified" ? [{ type: "separator" as const }, { label: "Start review", icon: <FileSearch />, onSelect: () => void run(reviewDocumentAction(d.id, "start_review")) }] : []),
          ...(perms.verify && d.status !== "verified" ? [{ label: "Verify", icon: <CheckCircle2 />, onSelect: () => void run(reviewDocumentAction(d.id, "verify")) }] : []),
          ...(perms.reject
            ? [
                { label: "Reject…", icon: <XCircle />, onSelect: () => setReason({ id: d.id, action: "reject" }) },
                { label: "Request replacement…", icon: <RotateCcw />, onSelect: () => setReason({ id: d.id, action: "request_replacement" }) },
              ]
            : []),
          ...(perms.share && !d.uploadedByClient
            ? [
                { type: "separator" as const },
                d.visibility === "internal_only"
                  ? { label: "Share with client", icon: <Eye />, onSelect: () => void run(setDocumentVisibilityAction(d.id, "shared_with_client")) }
                  : { label: "Make internal only", icon: <EyeOff />, onSelect: () => void run(setDocumentVisibilityAction(d.id, "internal_only")) },
              ]
            : []),
          ...(perms.archive
            ? [{ type: "separator" as const }, { label: "Archive", icon: <Archive />, danger: true, onSelect: () => { if (window.confirm(`Archive “${d.title ?? d.fileName}”? It will be hidden from staff lists and the client portal.`)) void run(archiveDocumentByIdAction(d.id)); } }]
            : []),
        ]}
        empty={{ title: "No documents match", body: "Upload a document, or send the client a document request.", icon: <FileText /> }}
      />
      <ReasonDialog
        open={!!reason}
        title={reason?.action === "reject" ? "Reject document" : "Request replacement"}
        onClose={() => setReason(null)}
        onSubmit={async (note) => {
          if (!reason) return;
          await run(reviewDocumentAction(reason.id, reason.action, note));
          setReason(null);
        }}
      />
    </>
  );
}
