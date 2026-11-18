"use client";

import Link from "next/link";
import { DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui";
import { TAX_PREPARATION_STATUS_LABELS, formatDate } from "@/lib/labels";
import type { listTaxPreparationCases } from "@/services/tax";

/**
 * The cases table runs in the browser (search, filters, sorting), so it must be a client
 * component: the server page passes only data, never functions.
 */
export type TaxPreparationCaseRow = Awaited<ReturnType<typeof listTaxPreparationCases>>[number];

const STATUS_TONE = {
  not_started: "neutral",
  documents_requested: "warn",
  awaiting_documents: "warn",
  documents_received: "info",
  verification: "info",
  ready_for_preparation: "brand",
  in_preparation: "brand",
  internal_review: "info",
  changes_required: "danger",
  completed: "good",
} as const;

export function TaxPreparationCasesTable({ cases, today }: { cases: TaxPreparationCaseRow[]; today: string }) {
  return (
    <DataTable
      label="Tax preparation cases"
      rows={cases}
      getId={(c) => c.id}
      rowHref={(c) => `/crm/tax-preparation/${c.id}`}
      initialSort={{ id: "due", dir: "asc" }}
      search={{ placeholder: "Search client, form, or jurisdiction", text: (c) => `${c.clientName} ${c.taxFormType} ${c.jurisdiction} ${c.preparerName ?? ""} ${c.reviewerName ?? ""}` }}
      filters={[
        { id: "status", label: "Status", options: Object.entries(TAX_PREPARATION_STATUS_LABELS).map(([value, label]) => ({ value, label })), match: (c, value) => c.status === value },
        { id: "year", label: "Tax year", options: [...new Set(cases.map((c) => c.taxYear))].sort((a, b) => b - a).map((year) => ({ value: String(year), label: String(year) })), match: (c, value) => String(c.taxYear) === value },
        { id: "client", label: "Client", options: [...new Map(cases.map((c) => [c.clientId, c.clientName])).entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label })), match: (c, value) => c.clientId === value },
      ]}
      columns={[
        { id: "client", header: "Client / case", sort: (c) => c.clientName, cell: (c) => <div><Link href={`/crm/tax-preparation/${c.id}`} className="font-medium text-ink hover:underline">{c.clientName}</Link><p className="text-xs text-muted">{c.engagementTitle ?? "No engagement linked"}</p></div> },
        { id: "scope", header: "Tax scope", sort: (c) => `${c.taxYear} ${c.taxFormType}`, cell: (c) => <span className="whitespace-nowrap text-muted">{c.taxYear} · {c.taxFormType}<span className="block text-xs">{c.jurisdiction}</span></span> },
        { id: "status", header: "Status", sort: (c) => c.status, cell: (c) => <Badge tone={STATUS_TONE[c.status]} dot>{TAX_PREPARATION_STATUS_LABELS[c.status]}</Badge> },
        { id: "preparer", header: "Preparer", sort: (c) => c.preparerName, cell: (c) => <span className="text-muted">{c.preparerName ?? "—"}</span>, hideBelow: "lg" },
        { id: "reviewer", header: "Reviewer", sort: (c) => c.reviewerName, cell: (c) => <span className="text-muted">{c.reviewerName ?? "—"}</span>, hideBelow: "lg" },
        { id: "due", header: "Due", sort: (c) => c.dueDate, cell: (c) => <span className={`whitespace-nowrap ${c.dueDate && c.dueDate < today && c.status !== "completed" ? "font-medium text-danger-ink" : "text-muted"}`}>{formatDate(c.dueDate)}</span> },
        { id: "documents", header: "Documents", sort: (c) => c.documentCompletion, cell: (c) => <span className="tabular text-muted">{c.documentCompletion}%</span> },
      ]}
      empty={{ title: "No tax preparation cases yet", body: "Create a case to start a tax workflow for an existing client." }}
    />
  );
}
