import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { Badge, ButtonLink, Card, DescriptionList, PageHeader, TabNav } from "@/components/ui";
import { requireStaffActor } from "@/lib/auth/current";
import { TAX_PREPARATION_STATUS_LABELS, formatDate } from "@/lib/labels";
import { listClientDocuments } from "@/services/documents";
import { listEntityTimeline } from "@/services/timeline";
import { getTaxPreparationCase } from "@/services/tax";
import { CreateReturnFromPreparationButton, TaxChecklistItemForm, TaxDocumentUploadForm, TaxPreparationStatusForm } from "../tax-forms";

export const metadata: Metadata = { title: "Tax Preparation Case" };

export default async function TaxPreparationCasePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const actor = await requireStaffActor();
  const { id } = await params;
  const requestedTab = (await searchParams).tab;
  const allowedTabs = ["overview", "documents", "notes", "activities"] as const;
  const tab = allowedTabs.includes(requestedTab as (typeof allowedTabs)[number]) ? requestedTab! : "overview";
  const db = getDb();
  let data;
  try {
    data = await getTaxPreparationCase(db, actor, id);
  } catch {
    notFound();
  }
  const { preparationCase: c, checklist, linkedReturn } = data;
  const [documents, activities] = await Promise.all([
    listClientDocuments(db, actor, c.clientId),
    listEntityTimeline(db, actor, "tax_preparation", c.id),
  ]);
  const completeCount = checklist.filter((item) => item.status === "verified" || item.status === "not_applicable").length;
  const completion = checklist.length ? Math.round((completeCount / checklist.length) * 100) : 0;

  return (
    <>
      <PageHeader
        title={`${data.clientName} · Tax preparation`}
        description={`${c.taxYear} · ${c.taxFormType} · ${c.jurisdiction}${data.engagementTitle ? ` · ${data.engagementTitle}` : ""}`}
        actions={<ButtonLink href="/crm/tax-preparation" variant="secondary">All preparation cases</ButtonLink>}
        meta={<Badge tone={c.status === "completed" ? "good" : "brand"} dot>{TAX_PREPARATION_STATUS_LABELS[c.status]}</Badge>}
      />
      <TabNav label="Tax preparation case" items={allowedTabs.map((name) => ({
        href: `/crm/tax-preparation/${c.id}?tab=${name}`,
        label: name === "activities" ? "Activities" : name[0]!.toUpperCase() + name.slice(1),
        active: tab === name,
      }))} />

      {tab === "overview" ? (
        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <Card title="Case overview">
            <DescriptionList items={[
              ["Client", <Link key="client" href={`/crm/clients/${c.clientId}`} className="hover:underline">{data.clientName}</Link>],
              ["Engagement", data.engagementTitle],
              ["Tax year / period", `${c.taxYear} · ${c.taxPeriod}`],
              ["Jurisdiction", c.jurisdiction],
              ["Tax form", c.taxFormType],
              ["Filing type", `${c.filingType} · sequence ${c.returnSequence}`],
              ["Preparer", data.preparerName],
              ["Reviewer", data.reviewerName],
              ["Due date", formatDate(c.dueDate)],
              ["Documents verified", `${completion}% (${completeCount}/${checklist.length})`],
              ["Started", c.preparationStartedAt?.toLocaleDateString() ?? "—"],
              ["Submitted for review", c.submittedForReviewAt?.toLocaleDateString() ?? "—"],
            ]} />
          </Card>
          <div className="space-y-5">
            <Card title="Preparation status">
              <TaxPreparationStatusForm id={c.id} status={c.status} />
            </Card>
            <Card title="Related tax return">
              {linkedReturn ? (
                <p className="text-[13px]"><Link href={`/crm/tax-returns/${linkedReturn.id}`} className="font-medium text-brand hover:underline">{linkedReturn.returnNumber}</Link><span className="text-muted"> · {linkedReturn.status.replaceAll("_", " ")}</span></p>
              ) : <><p className="mb-3 text-[13px] text-muted">Create exactly one return record from this case after preparation begins and required documents are resolved.</p><CreateReturnFromPreparationButton id={c.id} /></>}
            </Card>
          </div>
        </div>
      ) : null}

      {tab === "documents" ? (
        <div className="mt-5 space-y-5">
          <Card title="Document checklist" description="Only active client documents are selectable; files remain subject to the existing document permissions.">
            {checklist.length ? (
              <ul className="divide-y divide-line">
                {checklist.map((item) => (
                  <li key={item.id} className="space-y-3 py-4 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-[13px] font-medium text-ink">{item.name}{item.required ? <span className="text-danger"> *</span> : null}</p>
                        {item.description ? <p className="text-xs text-muted">{item.description}</p> : null}
                        <p className="mt-1 text-xs text-muted">
                          Requested {item.requestedAt?.toLocaleDateString() ?? "—"} · Received {item.receivedAt?.toLocaleDateString() ?? "—"} · Verified {item.verifiedAt?.toLocaleDateString() ?? "—"}
                        </p>
                      </div>
                    </div>
                    <TaxChecklistItemForm
                      id={item.id}
                      status={item.status}
                      documentId={item.documentId}
                      notes={item.notes}
                      documents={documents.map((doc) => ({ id: doc.id, fileName: doc.fileName }))}
                    />
                  </li>
                ))}
              </ul>
            ) : <p className="text-[13px] text-muted">No document requirements matched this case. A manager can configure requirements on the preparation page.</p>}
          </Card>
          <Card title="Upload supporting document">
            <TaxDocumentUploadForm clientId={c.clientId} engagementId={c.engagementId} />
            {documents.length ? <ul className="mt-4 divide-y divide-line text-[13px]">{documents.map((doc) => (
              <li key={doc.id} className="flex justify-between gap-3 py-2"><Link href={`/api/documents/${doc.id}`} className="truncate text-brand hover:underline">{doc.fileName}</Link><span className="shrink-0 text-muted">{formatDate(doc.createdAt.toISOString().slice(0, 10))}</span></li>
            ))}</ul> : <p className="mt-4 text-[13px] text-muted">No client documents are available yet.</p>}
          </Card>
        </div>
      ) : null}

      {tab === "notes" ? (
        <Card title="Internal preparation notes" className="mt-5">
          <p className="whitespace-pre-wrap text-[13px] text-ink">{c.internalNotes || "No internal notes have been added."}</p>
          <p className="mt-3 text-xs text-muted">Internal notes are staff-only and are not shared through the client portal.</p>
        </Card>
      ) : null}

      {tab === "activities" ? (
        <Card title="Case activities" className="mt-5">
          {activities.length ? <ol className="space-y-3">{activities.map((item) => (
            <li key={item.id} className="border-l-2 border-line pl-3">
              <p className="text-[13px] text-ink">{item.body ?? item.type.replaceAll("_", " ")}</p>
              <p className="text-xs text-muted">{item.actorName ?? "System"} · {item.occurredAt.toLocaleString()}</p>
            </li>
          ))}</ol> : <p className="text-[13px] text-muted">No activity recorded.</p>}
        </Card>
      ) : null}
    </>
  );
}
