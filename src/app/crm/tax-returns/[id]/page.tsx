import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { Badge, ButtonLink, Card, DescriptionList, PageHeader, TabNav } from "@/components/ui";
import { requireStaffActor } from "@/lib/auth/current";
import { can } from "@/lib/auth/permissions";
import { TAX_AUTHORIZATION_STATUS_LABELS, TAX_FILING_STATUS_LABELS, TAX_REVIEW_STATUS_LABELS, TAX_RETURN_STATUS_LABELS, formatDate, formatMoney } from "@/lib/labels";
import { listEntityTimeline } from "@/services/timeline";
import { getTaxReturn, listTaxReturnDocuments } from "@/services/tax";
import { TaxDocumentUploadForm, TaxReturnPreparationDataForm, TaxReturnWorkflowForms } from "@/app/crm/tax-preparation/tax-forms";

export const metadata: Metadata = { title: "Tax Return" };

const tabs = ["overview", "preparation", "documents", "review", "filing-history", "activities"] as const;

export default async function TaxReturnDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const actor = await requireStaffActor();
  const { id } = await params;
  const requested = (await searchParams).tab;
  const tab = tabs.includes(requested as (typeof tabs)[number]) ? requested! : "overview";
  const db = getDb();
  let data;
  try {
    data = await getTaxReturn(db, actor, id);
  } catch {
    notFound();
  }
  const { taxReturn: r } = data;
  const [documents, activities] = await Promise.all([
    listTaxReturnDocuments(db, actor, r.id),
    listEntityTimeline(db, actor, "tax_return", r.id),
  ]);
  const canReview = can(actor, "tax_returns", "approve") && (actor.role !== "employee" || r.reviewerId === actor.userId);
  const canFile = can(actor, "tax_returns", "file");

  return (
    <>
      <PageHeader
        title={`${r.returnNumber} · ${data.clientName}`}
        description={`${r.taxYear} · ${r.taxFormType} · ${r.jurisdiction}${data.engagementTitle ? ` · ${data.engagementTitle}` : ""}`}
        actions={<ButtonLink href="/crm/tax-returns" variant="secondary">All returns</ButtonLink>}
        meta={<Badge tone={r.status === "accepted" ? "good" : r.status === "rejected" ? "danger" : r.status === "filed" ? "brand" : "neutral"} dot>{TAX_RETURN_STATUS_LABELS[r.status]}</Badge>}
      />
      <TabNav label="Tax return" items={tabs.map((name) => ({
        href: `/crm/tax-returns/${r.id}?tab=${name}`,
        label: name === "filing-history" ? "Filing History" : name[0]!.toUpperCase() + name.slice(1),
        active: tab === name,
      }))} />

      {tab === "overview" ? (
        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <Card title="Return overview">
            <DescriptionList items={[
              ["Client", <Link key="client" href={`/crm/clients/${r.clientId}`} className="hover:underline">{data.clientName}</Link>],
              ["Engagement", data.engagementTitle],
              ["Tax year / period", `${r.taxYear} · ${r.taxPeriod}`],
              ["Taxpayer type", r.taxpayerType],
              ["Filing type", `${r.filingType} · sequence ${r.returnSequence}`],
              ["Tax form", r.taxFormType],
              ["Jurisdiction", r.jurisdiction],
              ["Preparer", data.preparerName],
              ["Reviewer", data.reviewerName],
              ["Filing deadline", formatDate(r.filingDeadline)],
              ["Review", TAX_REVIEW_STATUS_LABELS[r.reviewStatus]],
              ["Client authorization", TAX_AUTHORIZATION_STATUS_LABELS[r.authorizationStatus]],
              ["Filing", TAX_FILING_STATUS_LABELS[r.filingStatus]],
              ["Filing date", formatDate(r.filingDate)],
              ["Refund", r.refundAmountCents === null ? "—" : formatMoney(r.refundAmountCents)],
              ["Amount owed", r.amountOwedCents === null ? "—" : formatMoney(r.amountOwedCents)],
            ]} />
          </Card>
          <div className="space-y-5">
            <Card title="Lifecycle">
              <p className="text-[13px] text-muted">Preparation, review, client authorization, and filing results are tracked independently. This record never files electronically.</p>
              <dl className="mt-4 space-y-3 text-[13px]">
                <div><dt className="text-xs text-muted">Status</dt><dd className="font-medium text-ink">{TAX_RETURN_STATUS_LABELS[r.status]}</dd></div>
                <div><dt className="text-xs text-muted">Authority response</dt><dd className="font-medium text-ink">{r.authorityStatus ? r.authorityStatus[0]!.toUpperCase() + r.authorityStatus.slice(1) : "Not received"}</dd></div>
              </dl>
            </Card>
            {r.preparationCaseId ? <Card title="Preparation case"><Link href={`/crm/tax-preparation/${r.preparationCaseId}`} className="text-[13px] font-medium text-brand hover:underline">Open linked preparation case</Link></Card> : null}
          </div>
        </div>
      ) : null}

      {tab === "preparation" ? (
        <Card title="Preparation" className="mt-5">
          <DescriptionList items={[
            ["Linked preparation case", r.preparationCaseId ? <Link key="case" href={`/crm/tax-preparation/${r.preparationCaseId}`} className="text-brand hover:underline">Open case checklist and notes</Link> : "No case linked"],
            ["Preparer", data.preparerName],
            ["Reviewer", data.reviewerName],
            ["Tax year", r.taxYear],
            ["Form", r.taxFormType],
            ["Jurisdiction", r.jurisdiction],
          ]} />
          {r.internalNotes ? <div className="mt-5 border-t border-line pt-4"><h2 className="text-xs font-medium text-muted">Internal notes</h2><p className="mt-1 whitespace-pre-wrap text-[13px] text-ink">{r.internalNotes}</p></div> : null}
          {can(actor, "tax_preparation", "edit") && ["in_preparation", "changes_required"].includes(r.status) ? (
            <TaxReturnPreparationDataForm id={r.id} refundAmountCents={r.refundAmountCents} amountOwedCents={r.amountOwedCents} internalNotes={r.internalNotes} />
          ) : <p className="mt-4 text-xs text-muted">Tax calculations should use approved tax rules or external tax software; this CRM does not calculate tax liability.</p>}
        </Card>
      ) : null}

      {tab === "documents" ? (
        <div className="mt-5 space-y-5">
          <Card title="Supporting documents">
            {documents.length ? <ul className="divide-y divide-line">{documents.map((doc) => (
              <li key={doc.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <Link href={`/api/documents/${doc.id}`} className="text-[13px] font-medium text-brand hover:underline">{doc.fileName}</Link>
                <span className="text-xs text-muted">{formatDate(doc.createdAt.toISOString().slice(0, 10))}{doc.visibleToClient ? " · Shared with client" : " · Staff only"}</span>
              </li>
            ))}</ul> : <p className="text-[13px] text-muted">No supporting documents are attached to this client or engagement.</p>}
          </Card>
          <Card title="Upload supporting document">
            <TaxDocumentUploadForm clientId={r.clientId} engagementId={r.engagementId} />
          </Card>
        </div>
      ) : null}

      {tab === "review" ? (
        <Card title="Review and filing workflow" className="mt-5">
          <TaxReturnWorkflowForms
            id={r.id}
            status={r.status}
            authorizationStatus={r.authorizationStatus}
            reviewerCanAct={canReview}
            filingCanAct={canFile}
            today={new Date().toISOString().slice(0, 10)}
          />
        </Card>
      ) : null}

      {tab === "filing-history" ? (
        <Card title="Filing history" className="mt-5">
          {data.history.length ? <ol className="space-y-4">{data.history.map((item) => (
            <li key={item.id} className="border-l-2 border-line pl-3">
              <p className="text-[13px] font-medium text-ink">{item.eventType.replaceAll("_", " ")}</p>
              <p className="text-xs text-muted">{item.actorName ?? "System"} · {item.createdAt.toLocaleString()}</p>
              {item.filingDate ? <p className="mt-1 text-[13px] text-muted">Filing date: {formatDate(item.filingDate)}</p> : null}
              {item.submissionReference ? <p className="text-[13px] text-muted">Reference: {item.submissionReference}</p> : null}
              {item.authorityStatus ? <p className="text-[13px] text-muted">Authority response: {item.authorityStatus}</p> : null}
              {item.authorityResponse ? <p className="whitespace-pre-wrap text-[13px] text-muted">{item.authorityResponse}</p> : null}
            </li>
          ))}</ol> : <p className="text-[13px] text-muted">No return history is recorded yet.</p>}
        </Card>
      ) : null}

      {tab === "activities" ? (
        <Card title="Activities" className="mt-5">
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
