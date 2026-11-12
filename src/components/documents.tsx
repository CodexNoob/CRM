"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import { Archive, Download, Eye, EyeOff, FileText, Upload } from "lucide-react";
import { bulkDocumentArchiveAction, bulkDocumentShareAction } from "@/app/actions/bulk";
import { DataTable } from "@/components/data-table";
import { FormMessage, SubmitButton, inputClass } from "@/components/form";
import { Badge, cx } from "@/components/ui";
import { idleState, type ActionState } from "@/lib/action-state";
import { ACCEPT_ATTRIBUTE } from "@/lib/file-rules";
import { formatBytes } from "@/lib/labels";

export interface DocItem {
  id: string;
  fileName: string;
  sizeBytes: number;
  engagementTitle: string | null;
  uploadedByName: string | null;
  uploadedByClient: boolean;
  visibleToClient: boolean;
  scanStatus: "not_scanned" | "pending" | "clean" | "infected";
  createdAt: string;
  clientName?: string;
  clientId?: string;
}

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;
const dateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

export function UploadForm({ action, engagements, staff, label = "Upload a file", compact }: { action: Action; engagements?: { id: string; title: string }[]; staff?: boolean; label?: string; compact?: boolean }) {
  const [state, formAction] = useActionState(action, idleState);
  const ref = useRef<HTMLFormElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  useEffect(() => {
    if (state.status === "success") ref.current?.reset();
  }, [state]);
  const fileError = state.fieldErrors?.file?.join(" ");
  const shownName = state.status === "success" ? null : fileName;

  return (
    <form ref={ref} action={formAction} className="space-y-3" noValidate onReset={() => setFileName(null)}>
      <FormMessage state={fileError ? { status: "error", message: fileError } : state} />
      <label className={cx("flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-line-strong bg-hover px-4 text-center hover:border-brand/50 hover:bg-brand-soft/30", compact ? "py-4" : "py-6")}>
        <Upload className="size-4 text-muted" aria-hidden />
        <span className="text-[13px] font-medium text-ink">{shownName ?? label}</span>
        <span className="text-[12px] text-muted">PDF, images, Excel, Word, CSV or text · up to 25 MB</span>
        <input name="file" type="file" required accept={ACCEPT_ATTRIBUTE} className="sr-only" onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)} />
      </label>
      <div className="flex flex-wrap items-end gap-3">
        {engagements && engagements.length ? (
          <div className="min-w-48 flex-1 space-y-1.5">
            <label htmlFor="engagementId" className="block text-[12.5px] font-medium text-ink">Engagement</label>
            <select id="engagementId" name="engagementId" className={inputClass}>
              <option value="">None</option>
              {engagements.map((e) => (
                <option key={e.id} value={e.id}>{e.title}</option>
              ))}
            </select>
          </div>
        ) : null}
        {staff ? (
          <label className="flex h-8 items-center gap-2 text-[13px] text-ink">
            <input type="checkbox" name="visibleToClient" className="size-3.5 accent-brand" />
            Share with client
          </label>
        ) : null}
        <SubmitButton pendingText="Uploading…" className="ml-auto">
          <Upload /> Upload
        </SubmitButton>
      </div>
    </form>
  );
}

function ScanBadge({ status }: { status: DocItem["scanStatus"] }) {
  if (status === "clean") return <Badge tone="good" dot>Scanned</Badge>;
  if (status === "pending") return <Badge>Scanning</Badge>;
  return (
    <span title="No malware scanner is connected yet. Open files from unknown senders with care.">
      <Badge tone="warn" dot>Not scanned</Badge>
    </span>
  );
}

/** Documents as a data table. Staff get share/archive (single and bulk); clients get download only. */
export function DocumentList({ docs, staff, showClient }: { docs: DocItem[]; staff?: boolean; showClient?: boolean }) {
  const router = useRouter();
  return (
    <DataTable
      label="Documents"
      rows={docs}
      getId={(d) => d.id}
      initialSort={{ id: "added", dir: "desc" }}
      pageSize={20}
      search={{ placeholder: "Search files", text: (d) => `${d.fileName} ${d.clientName ?? ""} ${d.engagementTitle ?? ""}` }}
      filters={
        staff
          ? [
              { id: "vis", label: "Visibility", options: [{ value: "shared", label: "Shared" }, { value: "internal", label: "Internal" }], match: (d, v) => (v === "shared" ? d.visibleToClient : !d.visibleToClient) },
              { id: "from", label: "From", options: [{ value: "client", label: "Client" }, { value: "staff", label: "Staff" }], match: (d, v) => (v === "client" ? d.uploadedByClient : !d.uploadedByClient) },
            ]
          : []
      }
      bulkActions={
        staff
          ? [
              { label: "Share", icon: <Eye />, run: (ids) => bulkDocumentShareAction(ids, true) },
              { label: "Unshare", icon: <EyeOff />, run: (ids) => bulkDocumentShareAction(ids, false) },
              { label: "Archive", icon: <Archive />, variant: "danger", confirm: "Archive {n} document(s)? They will be hidden from staff and clients.", run: (ids) => bulkDocumentArchiveAction(ids) },
            ]
          : undefined
      }
      columns={[
        {
          id: "name",
          header: "File",
          sort: (d) => d.fileName.toLowerCase(),
          cell: (d) => (
            <div className="flex min-w-0 items-center gap-2.5">
              <FileText className="size-4 shrink-0 text-faint" aria-hidden />
              <div className="min-w-0">
                <a href={`/api/documents/${d.id}`} className="block truncate font-medium text-ink hover:text-brand hover:underline">{d.fileName}</a>
                <div className="truncate text-[12px] text-muted">
                  {formatBytes(d.sizeBytes)}
                  {d.engagementTitle ? ` · ${d.engagementTitle}` : ""}
                </div>
              </div>
            </div>
          ),
        },
        ...(showClient ? [{ id: "client", header: "Client", sort: (d: DocItem) => d.clientName ?? "", hideBelow: "md" as const, cell: (d: DocItem) => <span className="text-ink">{d.clientName}</span> }] : []),
        { id: "from", header: "Uploaded by", sort: (d) => d.uploadedByName ?? "", hideBelow: "md", cell: (d) => <span className="text-muted">{d.uploadedByName ?? "—"}{d.uploadedByClient ? " (client)" : ""}</span> },
        ...(staff ? [{ id: "vis", header: "Visibility", sort: (d: DocItem) => (d.visibleToClient ? 1 : 0), hideBelow: "sm" as const, cell: (d: DocItem) => (d.visibleToClient ? <Badge tone="brand">Shared</Badge> : <Badge>Internal</Badge>) }] : []),
        { id: "scan", header: "Scan", hideBelow: "lg", cell: (d) => <ScanBadge status={d.scanStatus} /> },
        { id: "added", header: "Added", sort: (d) => d.createdAt, align: "right", cell: (d) => <span className="tabular whitespace-nowrap text-muted">{dateFmt.format(new Date(d.createdAt))}</span> },
      ]}
      rowActions={(d) => [
        { label: "Download", icon: <Download />, href: `/api/documents/${d.id}` },
        ...(staff
          ? [
              ...(!d.uploadedByClient ? [{ label: d.visibleToClient ? "Unshare" : "Share with client", icon: d.visibleToClient ? <EyeOff /> : <Eye />, onSelect: () => void bulkDocumentShareAction([d.id], !d.visibleToClient).then(() => router.refresh()) }] : []),
              { type: "separator" as const },
              { label: "Archive", icon: <Archive />, danger: true, onSelect: () => { if (window.confirm(`Archive “${d.fileName}”?`)) void bulkDocumentArchiveAction([d.id]).then(() => router.refresh()); } },
            ]
          : []),
      ]}
      empty={{ title: "No documents yet", body: staff ? "Upload a file, or ask the client to send documents through their portal." : "Files you send us, and files we share with you, appear here.", icon: <FileText /> }}
    />
  );
}

