import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getDb } from "@/db";
import { SimpleTable, td, tdHide } from "@/components/table";
import { Badge, DescriptionList, PageHeader, Panel } from "@/components/ui";
import { requireStaffActor } from "@/lib/auth/current";
import { can } from "@/lib/auth/permissions";
import { orNotFound } from "@/lib/page-helpers";
import { firmToday } from "@/services/dashboard";
import {
  DOCUMENT_CATEGORY_LABELS,
  recordRequestNumber,
  REQUEST_ITEM_STATUS_LABELS,
  REQUEST_ITEM_STATUS_TONE,
  REQUEST_STATUS_LABELS,
  REQUEST_STATUS_TONE,
} from "@/services/document-labels";
import { getDocumentRequest } from "@/services/document-requests";
import { WaiveItemButton } from "../../document-controls";
import { RequestActions } from "../../requests-view";

export const metadata: Metadata = { title: "Document request" };

const dateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const dateTime = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

export default async function DocumentRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireStaffActor();
  const { id } = await params;
  const r = await orNotFound(getDocumentRequest(getDb(), actor, id, firmToday()));
  const canRequest = can(actor, "documents", "request");
  const canWaive = can(actor, "documents", "verify");
  const open = r.status !== "cancelled" && r.status !== "fulfilled";

  return (
    <>
      <Link href="/staff/documents?tab=requests" className="mb-3 inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink">
        <ArrowLeft className="size-3.5" aria-hidden /> Requests
      </Link>
      <PageHeader
        title={r.title}
        description={
          <>
            {recordRequestNumber(r.requestNumber) ?? "Request"} · <Link href={`/staff/clients/${r.clientId}?tab=documents`} className="hover:underline">{r.clientName}</Link>
          </>
        }
        meta={
          <>
            <Badge tone={REQUEST_STATUS_TONE[r.status]} dot>{REQUEST_STATUS_LABELS[r.status]}</Badge>
            <span className="tabular">{r.done}/{r.total} required documents done</span>
          </>
        }
        actions={<RequestActions id={r.id} status={r.status} canRequest={canRequest} />}
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Panel title="Documents requested" flush>
          <SimpleTable
            label="Requested documents"
            headers={[{ label: "Document" }, { label: "Status" }, { label: "File", hideBelow: "md" }, { label: "", align: "right" }]}
          >
            {r.items.map((it) => (
              <tr key={it.id} className="border-t border-line align-top">
                <td className={td}>
                  <div className="font-medium text-ink">{it.title}</div>
                  <div className="text-[12px] text-muted">
                    {DOCUMENT_CATEGORY_LABELS[it.category]} · {it.required ? "Required" : "Optional"}
                  </div>
                  {it.description ? <div className="text-[12px] text-muted">{it.description}</div> : null}
                </td>
                <td className={td}>
                  <Badge tone={REQUEST_ITEM_STATUS_TONE[it.status]} dot>{REQUEST_ITEM_STATUS_LABELS[it.status]}</Badge>
                  {it.document?.reviewNote && (it.status === "rejected" || it.status === "replacement_requested") ? <div className="mt-1 text-[12px] text-muted">Note: {it.document.reviewNote}</div> : null}
                </td>
                <td className={`${td} ${tdHide.md}`}>
                  {it.document ? (
                    <Link href={`/staff/documents/${it.document.id}`} className="hover:underline">
                      {it.document.title || it.document.fileName}
                      {it.document.versionNumber > 1 ? ` (v${it.document.versionNumber})` : ""}
                    </Link>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
                <td className={`${td} text-right`}>{canWaive && open && it.status !== "verified" && it.status !== "waived" ? <WaiveItemButton itemId={it.id} /> : null}</td>
              </tr>
            ))}
          </SimpleTable>
        </Panel>
        <Panel title="Request">
          <DescriptionList
            columns={1}
            items={[
              ["Due", r.dueDate ? dateFmt.format(new Date(`${r.dueDate}T00:00:00Z`)) : "No due date"],
              ["Engagement", r.engagementTitle ?? "—"],
              ["Requested by", r.requestedByName ?? "—"],
              ["Sent", r.sentAt ? dateTime.format(r.sentAt) : "Not sent (draft)"],
              ["Created", dateTime.format(r.createdAt)],
              ["Message to client", r.description ? <span className="whitespace-pre-wrap">{r.description}</span> : "—"],
            ]}
          />
          <p className="mt-3 text-[12px] text-muted">The client sees this request in their portal once it’s sent. No email is sent from here yet.</p>
        </Panel>
      </div>
    </>
  );
}
