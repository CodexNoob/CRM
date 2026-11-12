import type { Metadata } from "next";
import { ShieldAlert } from "lucide-react";
import { getDb } from "@/db";
import { inputClass } from "@/components/form";
import { PageHeader, Panel, StatStrip, TabNav, buttonClass } from "@/components/ui";
import { documents, type DocumentCategory, type DocumentStatus, type DocumentVisibility } from "@/db/schema";
import { requireStaffActor } from "@/lib/auth/current";
import { can } from "@/lib/auth/permissions";
import { listClientOptions } from "@/services/clients";
import { firmToday } from "@/services/dashboard";
import { DOCUMENT_CATEGORY_LABELS, DOCUMENT_STATUS_LABELS, DOCUMENT_VISIBILITY_LABELS } from "@/services/document-labels";
import { listDocumentRequests } from "@/services/document-requests";
import { listDocuments } from "@/services/documents";
import { StaffDocumentsTable, UploadDocumentButton, type DocPerms } from "./documents-view";
import { CreateRequestButton, RequestsTable } from "./requests-view";

export const metadata: Metadata = { title: "Documents" };

type Search = { tab?: string; q?: string; client?: string; category?: string; status?: string; visibility?: string; year?: string; versions?: string };

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const actor = await requireStaffActor();
  const sp = await searchParams;
  const tab = sp.tab === "requests" ? "requests" : "documents";
  const db = getDb();
  const perms: DocPerms = {
    upload: can(actor, "documents", "upload"),
    download: can(actor, "documents", "download"),
    review: can(actor, "documents", "review"),
    verify: can(actor, "documents", "verify"),
    reject: can(actor, "documents", "reject"),
    share: can(actor, "documents", "share"),
    archive: can(actor, "documents", "archive"),
    edit: can(actor, "documents", "edit"),
    request: can(actor, "documents", "request"),
  };
  const category = sp.category && (documents.category.enumValues as readonly string[]).includes(sp.category) ? (sp.category as DocumentCategory) : undefined;
  const status = sp.status && (documents.status.enumValues as readonly string[]).includes(sp.status) ? (sp.status as DocumentStatus) : undefined;
  const visibility = sp.visibility && (documents.visibility.enumValues as readonly string[]).includes(sp.visibility) ? (sp.visibility as DocumentVisibility) : undefined;
  const taxYear = sp.year && /^\d{4}$/.test(sp.year) ? Number(sp.year) : undefined;

  const [docs, clients, requests] = await Promise.all([
    listDocuments(db, actor, { q: sp.q, clientId: sp.client, category, status, visibility, taxYear, currentOnly: sp.versions !== "all" }),
    listClientOptions(db, actor),
    listDocumentRequests(db, actor, { today: firmToday() }),
  ]);
  const clientOptions = clients.map((c) => ({ id: c.id, name: c.name }));
  const openRequests = requests.filter((r) => ["sent", "partially_fulfilled", "overdue"].includes(r.status));

  return (
    <>
      <PageHeader
        title="Documents"
        description="Files exchanged with clients: requests, uploads, review and versions."
        actions={
          <div className="flex flex-wrap gap-2">
            {perms.request ? <CreateRequestButton clients={clientOptions} defaultClientId={sp.client} /> : null}
            {perms.upload ? <UploadDocumentButton clients={clientOptions} defaultClientId={sp.client} /> : null}
          </div>
        }
      />
      <StatStrip
        className="mb-4"
        items={[
          { label: "Awaiting review", value: docs.filter((d) => d.status === "uploaded" || d.status === "under_review").length, href: "/staff/documents?status=under_review", tone: "warning" },
          { label: "Replacement requested", value: docs.filter((d) => d.status === "replacement_requested" || d.status === "rejected").length, href: "/staff/documents?status=replacement_requested" },
          { label: "Open requests", value: openRequests.length, href: "/staff/documents?tab=requests" },
          { label: "Overdue requests", value: requests.filter((r) => r.status === "overdue").length, href: "/staff/documents?tab=requests", tone: requests.some((r) => r.status === "overdue") ? "danger" : "default" },
        ]}
      />
      <div className="mb-4">
        <TabNav
          label="Document sections"
          items={[
            { href: "/staff/documents", label: "Documents", active: tab === "documents", count: docs.length },
            { href: "/staff/documents?tab=requests", label: "Requests", active: tab === "requests", count: openRequests.length },
          ]}
        />
      </div>

      {tab === "documents" ? (
        <>
          <form method="get" className="mb-3 grid gap-2 rounded-lg border border-line bg-surface p-3 sm:grid-cols-2 lg:grid-cols-7" aria-label="Filter documents">
            <input name="q" defaultValue={sp.q ?? ""} placeholder="File name or client" aria-label="Search" className={`${inputClass} lg:col-span-2`} />
            <select name="client" defaultValue={sp.client ?? ""} aria-label="Client" className={inputClass}>
              <option value="">All clients</option>
              {clientOptions.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <select name="category" defaultValue={category ?? ""} aria-label="Category" className={inputClass}>
              <option value="">All categories</option>
              {Object.entries(DOCUMENT_CATEGORY_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
            <select name="status" defaultValue={status ?? ""} aria-label="Status" className={inputClass}>
              <option value="">Any status</option>
              {Object.entries(DOCUMENT_STATUS_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
            <select name="visibility" defaultValue={visibility ?? ""} aria-label="Visibility" className={inputClass}>
              <option value="">Any visibility</option>
              {Object.entries(DOCUMENT_VISIBILITY_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
            <input name="year" defaultValue={sp.year ?? ""} inputMode="numeric" maxLength={4} placeholder="Tax year" aria-label="Tax year" className={inputClass} />
            <label className="flex items-center gap-2 text-[12.5px] text-ink lg:col-span-2">
              <input type="checkbox" name="versions" value="all" defaultChecked={sp.versions === "all"} className="size-3.5 accent-brand" />
              Include older versions
            </label>
            <div className="flex gap-2 lg:col-span-5 lg:justify-end">
              <button type="submit" className={buttonClass("secondary", undefined, "sm")}>Apply</button>
              <a href="/staff/documents" className={buttonClass("ghost", undefined, "sm")}>Clear</a>
            </div>
          </form>
          <p className="mb-3 flex items-start gap-2 text-[12.5px] text-muted">
            <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            Files are stored privately and opened only after a permission check; every download is logged. Uploads are never verified automatically. No malware scanner is connected yet.
          </p>
          <Panel flush>
            <StaffDocumentsTable
              perms={perms}
              docs={docs.map((d) => ({
                id: d.id,
                documentNumber: d.documentNumber,
                title: d.title,
                fileName: d.fileName,
                contentType: d.contentType,
                sizeBytes: d.sizeBytes,
                category: d.category,
                status: d.status,
                visibility: d.visibility,
                versionNumber: d.versionNumber,
                clientId: d.clientId,
                clientName: d.clientName,
                engagementTitle: d.engagementTitle,
                taxYear: d.taxYear,
                uploadedByName: d.uploadedByName,
                uploadedByClient: d.uploadedByClient,
                createdAt: d.createdAt.toISOString(),
              }))}
            />
          </Panel>
        </>
      ) : (
        <Panel flush>
          <RequestsTable
            canRequest={perms.request}
            rows={requests.map((r) => ({
              id: r.id,
              requestNumber: r.requestNumber,
              title: r.title,
              clientId: r.clientId,
              clientName: r.clientName,
              status: r.status,
              dueDate: r.dueDate,
              total: r.total,
              done: r.done,
              itemCount: r.items.length,
              createdAt: r.createdAt.toISOString(),
            }))}
          />
        </Panel>
      )}
    </>
  );
}
