import type { Metadata } from "next";
import { ClipboardList } from "lucide-react";
import { getDb } from "@/db";
import { portalReplaceDocumentAction, portalRequestUploadAction } from "@/app/actions/documents";
import { portalUploadAction } from "@/app/actions/phase1";
import { DocumentList, UploadForm } from "@/components/documents";
import { Alert, Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { requirePortalContext } from "@/lib/auth/portal-context";
import { firmToday } from "@/services/dashboard";
import { REQUEST_ITEM_STATUS_TONE, REQUEST_STATUS_LABELS, REQUEST_STATUS_TONE } from "@/services/document-labels";
import { listPortalDocumentRequests } from "@/services/document-requests";
import { listPortalDocuments } from "@/services/documents";

export const metadata: Metadata = { title: "Documents" };

/** Plain-language item statuses for clients. */
const ITEM_LABEL: Record<keyof typeof REQUEST_ITEM_STATUS_TONE, string> = {
  pending: "Waiting for your file",
  uploaded: "Received",
  under_review: "Received — being reviewed",
  verified: "Accepted",
  rejected: "Not accepted — please send a new copy",
  replacement_requested: "Please send a new copy",
  waived: "Not needed",
};

const dateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export default async function PortalDocumentsPage() {
  // The client is resolved on the server from portal access — never from the URL or form.
  const ctx = await requirePortalContext();
  const db = getDb();
  const clientId = ctx.client.clientId;
  const [requests, docs] = await Promise.all([
    listPortalDocumentRequests(db, ctx.actor, clientId, firmToday()),
    listPortalDocuments(db, ctx.actor, clientId),
  ]);
  const outstanding = requests.filter((r) => r.status !== "fulfilled");

  return (
    <>
      <PageHeader title="Documents" description="Send your documents securely and download files we’ve shared with you." />
      <div className="space-y-6">
        <Card title="What we need from you">
          {outstanding.length ? (
            <div className="space-y-5">
              {outstanding.map((r) => (
                <section key={r.id} aria-labelledby={`req-${r.id}`} className="rounded-lg border border-line p-3">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <h3 id={`req-${r.id}`} className="text-[14px] font-semibold text-ink">{r.title}</h3>
                    <Badge tone={REQUEST_STATUS_TONE[r.status]} dot>{REQUEST_STATUS_LABELS[r.status]}</Badge>
                    {r.dueDate ? <span className="text-[12.5px] text-muted">Due {dateFmt.format(new Date(`${r.dueDate}T00:00:00Z`))}</span> : null}
                    <span className="ml-auto text-[12.5px] text-muted tabular">{r.done}/{r.total} done</span>
                  </div>
                  {r.description ? <p className="mb-3 whitespace-pre-wrap text-[13px] text-muted">{r.description}</p> : null}
                  <ul className="space-y-3">
                    {r.items.map((it) => {
                      const needsReplacement = it.status === "rejected" || it.status === "replacement_requested";
                      const canUpload = it.status === "pending" || needsReplacement;
                      return (
                        <li key={it.id} className="rounded-md bg-hover p-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-ink">{it.title}</span>
                            {!it.required ? <span className="text-[12px] text-muted">(optional)</span> : null}
                            <Badge tone={REQUEST_ITEM_STATUS_TONE[it.status]} dot>{ITEM_LABEL[it.status]}</Badge>
                          </div>
                          {it.description ? <p className="mt-1 text-[12.5px] text-muted">{it.description}</p> : null}
                          {it.document ? <p className="mt-1 text-[12.5px] text-muted">Sent: {it.document.fileName}</p> : null}
                          {needsReplacement && it.document?.reviewNote ? (
                            <div className="mt-2"><Alert tone="warning">Note from your firm: {it.document.reviewNote}</Alert></div>
                          ) : null}
                          {canUpload ? (
                            <div className="mt-2">
                              <UploadForm
                                compact
                                label={needsReplacement ? "Choose a new copy" : "Choose a file"}
                                action={needsReplacement && it.document ? portalReplaceDocumentAction.bind(null, it.document.id) : portalRequestUploadAction.bind(null, it.id)}
                              />
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          ) : (
            <EmptyState title="Nothing requested right now" icon={<ClipboardList />}>
              When your firm asks for documents, they’ll appear here.
            </EmptyState>
          )}
        </Card>
        <Card title="Send us another document">
          <UploadForm action={portalUploadAction} label="Choose a file" />
          <p className="mt-3 text-xs text-muted">Files go only to your firm. This is safer than email for W-2s, 1099s, statements and IDs. Please don’t put Social Security numbers in file names.</p>
        </Card>
        <Card title="Your documents">
          <DocumentList
            docs={docs.map((d) => ({
              id: d.id,
              fileName: d.fileName,
              title: d.title,
              status: d.status,
              reviewNote: d.status === "rejected" || d.status === "replacement_requested" ? d.reviewNote : null,
              sizeBytes: d.sizeBytes,
              engagementTitle: d.engagementTitle,
              uploadedByName: d.uploadedByName,
              uploadedByClient: d.uploadedByClient,
              visibleToClient: d.visibleToClient,
              scanStatus: d.scanStatus,
              createdAt: d.createdAt.toISOString(),
            }))}
          />
        </Card>
      </div>
    </>
  );
}
