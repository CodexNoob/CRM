"use client";

import { useRouter } from "next/navigation";
import { ArrowRightLeft, Briefcase, MessageSquare, Users } from "lucide-react";
import { bulkEngagementStatusAction } from "@/app/actions/bulk";
import type { EngagementStatus, ServiceType } from "@/db/schema";
import { CellTitle, DataTable, type BulkAction } from "@/components/data-table";
import { Badge } from "@/components/ui";
import { formatDate, SERVICE_LABELS, STATUS_LABELS } from "@/lib/labels";
import { dueLabel, ENGAGEMENT_TONE, ENGAGEMENT_DONE } from "@/lib/status";

export interface EngagementRow {
  id: string;
  title: string;
  status: EngagementStatus;
  serviceType: ServiceType;
  taxYear: number | null;
  dueDate: string | null;
  clientId: string;
  clientName: string;
  ownerName: string;
  openTasks: number;
}

const DONE: EngagementStatus[] = [...ENGAGEMENT_DONE];

export function EngagementsTable({
  rows,
  today,
  bulkStatuses = ["in_progress", "in_review", "completed"],
  showService = true,
  label = "Engagements",
  emptyTitle = "No engagements",
  emptyBody,
}: {
  rows: EngagementRow[];
  today: string;
  bulkStatuses?: EngagementStatus[];
  showService?: boolean;
  label?: string;
  emptyTitle?: string;
  emptyBody?: string;
}) {
  const router = useRouter();
  const owners = [...new Set(rows.map((r) => r.ownerName))].sort();
  const years = [...new Set(rows.map((r) => r.taxYear).filter((y): y is number => y !== null))].sort((a, b) => b - a);
  const services = [...new Set(rows.map((r) => r.serviceType))];

  const bulk: BulkAction[] = bulkStatuses.map((s) => ({
    label: `Mark ${STATUS_LABELS[s].toLowerCase()}`,
    run: (ids) => bulkEngagementStatusAction(ids, s),
  }));

  return (
    <DataTable
      label={label}
      rows={rows}
      getId={(r) => r.id}
      rowHref={(r) => `/crm/engagements/${r.id}`}
      initialSort={{ id: "due", dir: "asc" }}
      search={{ placeholder: "Search engagement or client", text: (r) => `${r.title} ${r.clientName} ${r.ownerName}` }}
      filters={[
        { id: "status", label: "Status", options: [...new Set(rows.map((r) => r.status))].map((s) => ({ value: s, label: STATUS_LABELS[s] })), match: (r, v) => r.status === v },
        ...(showService && services.length > 1 ? [{ id: "service", label: "Service", options: services.map((s) => ({ value: s, label: SERVICE_LABELS[s] })), match: (r: EngagementRow, v: string) => r.serviceType === v }] : []),
        ...(owners.length > 1 ? [{ id: "owner", label: "Owner", options: owners.map((o) => ({ value: o, label: o })), match: (r: EngagementRow, v: string) => r.ownerName === v }] : []),
        ...(years.length > 1 ? [{ id: "year", label: "Year", options: years.map((y) => ({ value: String(y), label: String(y) })), match: (r: EngagementRow, v: string) => String(r.taxYear) === v }] : []),
      ]}
      bulkActions={bulk}
      columns={[
        { id: "title", header: "Engagement", sort: (r) => r.title.toLowerCase(), cell: (r) => <CellTitle title={r.title} sub={r.taxYear ? `Tax year ${r.taxYear}` : SERVICE_LABELS[r.serviceType]} href={`/crm/engagements/${r.id}`} /> },
        { id: "client", header: "Client", sort: (r) => r.clientName.toLowerCase(), cell: (r) => <span className="text-ink">{r.clientName}</span> },
        ...(showService ? [{ id: "service", header: "Service", sort: (r: EngagementRow) => r.serviceType, hideBelow: "lg" as const, cell: (r: EngagementRow) => <span className="text-muted">{SERVICE_LABELS[r.serviceType]}</span> }] : []),
        { id: "status", header: "Status", sort: (r) => r.status, cell: (r) => <Badge tone={ENGAGEMENT_TONE[r.status]} dot>{STATUS_LABELS[r.status]}</Badge> },
        { id: "owner", header: "Owner", sort: (r) => r.ownerName, hideBelow: "md", cell: (r) => <span className="text-muted">{r.ownerName}</span> },
        {
          id: "due",
          header: "Due",
          sort: (r) => r.dueDate,
          cell: (r) => {
            const d = dueLabel(r.dueDate, today);
            const done = DONE.includes(r.status);
            return (
              <div className="whitespace-nowrap">
                <div className="tabular text-ink">{formatDate(r.dueDate)}</div>
                {!done && r.dueDate ? <div className={d.tone === "danger" ? "text-[12px] font-medium text-danger-ink" : d.tone === "warn" ? "text-[12px] text-warning-ink" : "text-[12px] text-muted"}>{d.text}</div> : null}
              </div>
            );
          },
        },
        { id: "tasks", header: "Tasks", align: "right", sort: (r) => r.openTasks, hideBelow: "sm", cell: (r) => r.openTasks },
      ]}
      rowActions={(r) => [
        { label: "Open engagement", icon: <Briefcase />, href: `/crm/engagements/${r.id}` },
        { label: "Open client", icon: <Users />, href: `/crm/clients/${r.clientId}` },
        { label: "Message client", icon: <MessageSquare />, href: `/crm/clients/${r.clientId}?tab=messages` },
        { type: "separator" },
        ...bulkStatuses
          .filter((s) => s !== r.status)
          .map((s) => ({ label: `Mark ${STATUS_LABELS[s].toLowerCase()}`, icon: <ArrowRightLeft />, onSelect: () => void bulkEngagementStatusAction([r.id], s).then(() => router.refresh()) })),
      ]}
      empty={{ title: emptyTitle, body: emptyBody, icon: <Briefcase /> }}
    />
  );
}
