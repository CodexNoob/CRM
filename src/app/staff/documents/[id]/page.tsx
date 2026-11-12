import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Download, Eye } from "lucide-react";
import { getDb } from "@/db";
import { SimpleTable, td, tdHide } from "@/components/table";
import { Alert, Badge, DescriptionList, PageHeader, Panel, buttonClass } from "@/components/ui";
import { requireStaffActor } from "@/lib/auth/current";
import { can } from "@/lib/auth/permissions";
import { formatBytes } from "@/lib/labels";
import { orNotFound } from "@/lib/page-helpers";
import { DOCUMENT_CATEGORY_LABELS, DOCUMENT_STATUS_LABELS, DOCUMENT_STATUS_TONE, DOCUMENT_VISIBILITY_LABELS, recordDocNumber } from "@/services/document-labels";
import { getDocumentDetail, listDocumentLinkOptions } from "@/services/documents";
import { MetadataForm, NewVersionForm, ReviewControls } from "../document-controls";
import type { DocPerms } from "../documents-view";

export const metadata: Metadata = { title: "Document" };

const dateTime = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
const PREVIEWABLE = new Set(["application/pdf", "image/png", "image/jpeg"]);

export default async function DocumentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireStaffActor();
  const { id } = await params;
  const db = getDb();
  const detail = await orNotFound(getDocumentDetail(db, actor, id));
  const { doc } = detail;
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
  const options = perms.edit ? await listDocumentLinkOptions(db, actor, doc.clientId) : null;
  const archived = !!doc.deletedAt;

  return (
    <>
      <Link href="/staff/documents" className="mb-3 inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink">
        <ArrowLeft className="size-3.5" aria-hidden /> Documents
      </Link>
      <PageHeader
        title={doc.title || doc.fileName}
        description={
          <>
            {recordDocNumber(doc.documentNumber) ?? "Document"} · <Link href={`/staff/clients/${doc.clientId}?tab=documents`} className="hover:underline">{detail.clientName}</Link> · version {doc.versionNumber}
          </>
        }
        meta={
          <>
            <Badge tone={DOCUMENT_STATUS_TONE[doc.status]} dot>{DOCUMENT_STATUS_LABELS[doc.status]}</Badge>
            <Badge tone={doc.visibility === "internal_only" ? "neutral" : "brand"}>{DOCUMENT_VISIBILITY_LABELS[doc.visibility]}</Badge>
            {!doc.isCurrentVersion ? <Badge tone="warn">Older version</Badge> : null}
          </>
        }
        actions={
          perms.download ? (
            <>
              {PREVIEWABLE.has(doc.contentType) ? (
                <a href={`/api/documents/${doc.id}?inline=1`} target="_blank" rel="noopener noreferrer" className={buttonClass("secondary")}>
                  <Eye /> Preview
                </a>
              ) : null}
              <a href={`/api/documents/${doc.id}`} className={buttonClass("primary")}>
                <Download /> Download
              </a>
            </>
          ) : null
        }
      />
      {archived ? <div className="mb-4"><Alert tone="warning">This document is archived. It is hidden from lists and the client portal; the file is kept.</Alert></div> : null}
      {doc.reviewNote && (doc.status === "rejected" || doc.status === "replacement_requested") ? (
        <div className="mb-4"><Alert tone="warning">Review note sent to the client: {doc.reviewNote}</Alert></div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-4">
          <Panel title="Details">
            <DescriptionList
              items={[
                ["File", `${doc.fileName} · ${formatBytes(doc.sizeBytes)}`],
                ["Category", DOCUMENT_CATEGORY_LABELS[doc.category]],
                ["Tax year", doc.taxYear ?? "—"],
                ["Engagement", detail.engagementTitle ?? "—"],
                ["Uploaded by", `${detail.uploadedByName ?? "—"}${doc.uploadedByClient ? " (client)" : ""}`],
                ["Uploaded", dateTime.format(doc.createdAt)],
                ["Reviewed by", detail.reviewedByName ? `${detail.reviewedByName}${doc.reviewedAt ? ` · ${dateTime.format(doc.reviewedAt)}` : ""}` : "—"],
                ["Malware scan", doc.scanStatus === "clean" ? "Scanned, clean" : "Not scanned (no scanner connected)"],
              ]}
            />
          </Panel>

          {options && !archived ? (
            <Panel title="Edit details" description="Links must belong to the same client.">
              <MetadataForm
                id={doc.id}
                initial={{
                  title: doc.title ?? "",
                  category: doc.category,
                  description: doc.description ?? "",
                  internalNotes: doc.internalNotes ?? "",
                  taxYear: doc.taxYear ? String(doc.taxYear) : "",
                  expirationDate: doc.expirationDate ?? "",
                  engagementId: doc.engagementId ?? "",
                  taxPreparationCaseId: doc.taxPreparationCaseId ?? "",
                  taxReturnId: doc.taxReturnId ?? "",
                }}
                options={{
                  engagements: options.engagements.map((e) => ({ id: e.id, label: e.title })),
                  taxCases: options.taxCases.map((c) => ({ id: c.id, label: `${c.taxYear} · ${c.form}` })),
                  taxReturns: options.taxReturns.map((r) => ({ id: r.id, label: `${r.taxYear} · return ${r.number ?? ""}`.trim() })),
                }}
              />
            </Panel>
          ) : doc.internalNotes ? (
            <Panel title="Internal notes" description="Staff only.">
              <p className="whitespace-pre-wrap text-[13px] text-ink">{doc.internalNotes}</p>
            </Panel>
          ) : null}

          <Panel title="Version history" flush>
            <SimpleTable
              label="Versions"
              headers={[{ label: "Version" }, { label: "File" }, { label: "Status", hideBelow: "sm" }, { label: "Uploaded by", hideBelow: "md" }, { label: "Added", align: "right" }]}
            >
              {detail.versions.map((v) => (
                <tr key={v.id} className="border-t border-line">
                  <td className={td}>
                    <Link href={`/staff/documents/${v.id}`} className="font-medium text-ink hover:underline">v{v.versionNumber}</Link>
                    {v.isCurrentVersion ? <span className="ml-1.5"><Badge tone="good">Current</Badge></span> : null}
                  </td>
                  <td className={td}>
                    {perms.download ? <a href={`/api/documents/${v.id}`} className="hover:underline">{v.fileName}</a> : v.fileName}
                    <span className="ml-1 text-[12px] text-muted">{formatBytes(v.sizeBytes)}</span>
                    {v.reviewNote ? <div className="text-[12px] text-muted">Note: {v.reviewNote}</div> : null}
                  </td>
                  <td className={`${td} ${tdHide.sm}`}><Badge tone={DOCUMENT_STATUS_TONE[v.status]}>{DOCUMENT_STATUS_LABELS[v.status]}</Badge></td>
                  <td className={`${td} ${tdHide.md} text-muted`}>{v.uploadedByName ?? "—"}{v.uploadedByClient ? " (client)" : ""}</td>
                  <td className={`${td} text-right text-muted`}>{dateTime.format(v.createdAt)}</td>
                </tr>
              ))}
            </SimpleTable>
          </Panel>
        </div>

        <div className="space-y-4">
          {!archived ? (
            <Panel title="Review">
              <ReviewControls id={doc.id} status={doc.status} visibility={doc.visibility} uploadedByClient={doc.uploadedByClient} isCurrent={doc.isCurrentVersion} perms={perms} />
              <p className="mt-3 text-[12px] text-muted">Uploads are never verified automatically. A person must open and check each file.</p>
            </Panel>
          ) : null}
          {perms.upload && doc.isCurrentVersion && !archived ? (
            <Panel title="New version" description="The current file is kept in the history.">
              <NewVersionForm id={doc.id} />
            </Panel>
          ) : null}
          <Panel title="Activity">
            {detail.activity.length ? (
              <ol className="space-y-2.5">
                {detail.activity.map((a) => (
                  <li key={a.id} className="text-[13px]">
                    <div className="text-ink">{a.body ?? "Updated"}</div>
                    <div className="text-[12px] text-muted">{a.actorName ?? "System"} · {dateTime.format(a.occurredAt)}</div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-[13px] text-muted">No activity yet.</p>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
