"use client";

import Link from "next/link";
import { DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui";
import { formatDate, TAX_RETURN_STATUS_LABELS } from "@/lib/labels";
import type { listTaxReturns } from "@/services/tax";

/**
 * The returns table runs in the browser (search, filters, sorting), so it must be a client
 * component: the server page passes only data, never functions.
 */
export type TaxReturnRow = Awaited<ReturnType<typeof listTaxReturns>>[number];

const STATUS_TONE = {
  not_started: "neutral",
  waiting_for_documents: "warn",
  in_preparation: "brand",
  ready_for_review: "info",
  under_review: "info",
  changes_required: "danger",
  awaiting_client_approval: "warn",
  approved: "good",
  filed: "brand",
  accepted: "good",
  rejected: "danger",
  amended: "info",
} as const;

export function TaxReturnsTable({ returns }: { returns: TaxReturnRow[] }) {
  const years = [...new Set(returns.map((r) => r.taxYear))].sort((a, b) => b - a);
  const clients = [...new Map(returns.map((r) => [r.clientId, r.clientName])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const preparers = [...new Map(returns.filter((r) => r.preparerId && r.preparerName).map((r) => [r.preparerId!, r.preparerName!])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const reviewers = [...new Map(returns.filter((r) => r.reviewerId && r.reviewerName).map((r) => [r.reviewerId!, r.reviewerName!])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const jurisdictions = [...new Set(returns.map((r) => r.jurisdiction))].sort();
  const forms = [...new Set(returns.map((r) => r.taxFormType))].sort();

  return (
    <DataTable
      label="Tax returns"
      rows={returns}
      getId={(r) => r.id}
      rowHref={(r) => `/staff/tax-returns/${r.id}`}
      initialSort={{ id: "due", dir: "asc" }}
      search={{ placeholder: "Search return, client, or form", text: (r) => `${r.returnNumber} ${r.clientName} ${r.taxFormType} ${r.jurisdiction} ${r.preparerName ?? ""} ${r.reviewerName ?? ""}` }}
      filters={[
        { id: "client", label: "Client", options: clients.map(([value, label]) => ({ value, label })), match: (r, value) => r.clientId === value },
        { id: "year", label: "Tax year", options: years.map((y) => ({ value: String(y), label: String(y) })), match: (r, value) => String(r.taxYear) === value },
        { id: "jurisdiction", label: "Jurisdiction", options: jurisdictions.map((j) => ({ value: j, label: j })), match: (r, value) => r.jurisdiction === value },
        { id: "form", label: "Form", options: forms.map((f) => ({ value: f, label: f })), match: (r, value) => r.taxFormType === value },
        { id: "status", label: "Status", options: Object.entries(TAX_RETURN_STATUS_LABELS).map(([value, label]) => ({ value, label })), match: (r, value) => r.status === value },
        { id: "preparer", label: "Preparer", options: preparers.map(([value, label]) => ({ value, label })), match: (r, value) => r.preparerId === value },
        { id: "reviewer", label: "Reviewer", options: reviewers.map(([value, label]) => ({ value, label })), match: (r, value) => r.reviewerId === value },
      ]}
      columns={[
        {
          id: "return",
          header: "Return",
          sort: (r) => r.returnNumber,
          cell: (r) => <div><Link href={`/staff/tax-returns/${r.id}`} className="font-medium text-ink hover:underline">{r.returnNumber}</Link><p className="text-xs text-muted">{r.taxYear} · {r.taxPeriod} · {r.filingType}</p></div>,
        },
        { id: "client", header: "Client", sort: (r) => r.clientName, cell: (r) => <span className="text-ink">{r.clientName}</span> },
        { id: "scope", header: "Form / jurisdiction", sort: (r) => `${r.taxFormType} ${r.jurisdiction}`, cell: (r) => <span className="text-muted">{r.taxFormType}<span className="block text-xs">{r.jurisdiction}</span></span>, hideBelow: "md" },
        { id: "status", header: "Status", sort: (r) => r.status, cell: (r) => <Badge tone={STATUS_TONE[r.status]} dot>{TAX_RETURN_STATUS_LABELS[r.status]}</Badge> },
        { id: "preparer", header: "Preparer", sort: (r) => r.preparerName, cell: (r) => <span className="text-muted">{r.preparerName ?? "—"}</span>, hideBelow: "lg" },
        { id: "reviewer", header: "Reviewer", sort: (r) => r.reviewerName, cell: (r) => <span className="text-muted">{r.reviewerName ?? "—"}</span>, hideBelow: "lg" },
        { id: "due", header: "Filing deadline", sort: (r) => r.filingDeadline, cell: (r) => <span className="whitespace-nowrap text-muted">{formatDate(r.filingDeadline)}</span> },
      ]}
      empty={{ title: "No tax return records", body: "Create a preparation case and create its linked return when preparation is underway." }}
    />
  );
}
