"use client";

import { useRouter } from "next/navigation";
import { Funnel, PhoneCall, Star, UserX } from "lucide-react";
import { bulkLeadStatusAction } from "@/app/actions/bulk";
import type { LeadSource, LeadStatus, ServiceType } from "@/db/schema";
import { CellTitle, DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui";
import { formatDate, LEAD_SOURCE_LABELS, LEAD_STATUS_LABELS, SERVICE_LABELS } from "@/lib/labels";
import { LEAD_TONE } from "@/lib/status";

export interface LeadRowData {
  id: string;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  status: LeadStatus;
  source: LeadSource;
  serviceInterest: ServiceType | null;
  ownerName: string | null;
  followUpDate: string | null;
  createdAt: string;
}

const dateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

export function LeadsTable({ rows, today }: { rows: LeadRowData[]; today: string }) {
  const router = useRouter();
  const set = (id: string, s: "contacted" | "qualified" | "lost") => void bulkLeadStatusAction([id], s).then(() => router.refresh());
  return (
    <DataTable
      label="Leads"
      rows={rows}
      getId={(r) => r.id}
      rowHref={(r) => `/staff/leads/${r.id}`}
      initialSort={{ id: "received", dir: "desc" }}
      search={{ placeholder: "Search name, company, email", text: (r) => `${r.name} ${r.company ?? ""} ${r.email ?? ""} ${r.phone ?? ""}` }}
      filters={[
        { id: "status", label: "Stage", options: (["new", "contacted", "qualified", "converted", "lost"] as const).map((s) => ({ value: s, label: LEAD_STATUS_LABELS[s] })), match: (r, v) => r.status === v },
        { id: "source", label: "Source", options: Object.entries(LEAD_SOURCE_LABELS).map(([value, label]) => ({ value, label })), match: (r, v) => r.source === v },
      ]}
      bulkActions={[
        { label: "Mark contacted", icon: <PhoneCall />, run: (ids) => bulkLeadStatusAction(ids, "contacted") },
        { label: "Mark qualified", icon: <Star />, run: (ids) => bulkLeadStatusAction(ids, "qualified") },
        { label: "Mark lost", icon: <UserX />, variant: "danger", confirm: "Mark {n} lead(s) as lost?", run: (ids) => bulkLeadStatusAction(ids, "lost") },
      ]}
      columns={[
        { id: "name", header: "Lead", sort: (r) => r.name.toLowerCase(), cell: (r) => <CellTitle title={r.name} sub={[r.company, r.email ?? r.phone].filter(Boolean).join(" · ") || "No contact details"} href={`/staff/leads/${r.id}`} /> },
        { id: "status", header: "Stage", sort: (r) => ["new", "contacted", "qualified", "converted", "lost"].indexOf(r.status), cell: (r) => <Badge tone={LEAD_TONE[r.status]} dot>{LEAD_STATUS_LABELS[r.status]}</Badge> },
        { id: "interest", header: "Interested in", sort: (r) => r.serviceInterest ?? "", hideBelow: "lg", cell: (r) => <span className="text-muted">{r.serviceInterest ? SERVICE_LABELS[r.serviceInterest] : "—"}</span> },
        { id: "source", header: "Source", sort: (r) => r.source, hideBelow: "md", cell: (r) => <span className="text-muted">{LEAD_SOURCE_LABELS[r.source]}</span> },
        { id: "owner", header: "Owner", sort: (r) => r.ownerName ?? "~", hideBelow: "md", cell: (r) => <span className="text-muted">{r.ownerName ?? "Unassigned"}</span> },
        {
          id: "follow",
          header: "Follow-up",
          sort: (r) => r.followUpDate,
          hideBelow: "sm",
          cell: (r) => (r.followUpDate ? <span className={r.followUpDate < today && r.status !== "converted" && r.status !== "lost" ? "tabular font-medium text-danger-ink" : "tabular text-ink"}>{formatDate(r.followUpDate)}</span> : <span className="text-faint">—</span>),
        },
        { id: "received", header: "Received", sort: (r) => r.createdAt, align: "right", cell: (r) => <span className="tabular text-muted">{dateFmt.format(new Date(r.createdAt))}</span> },
      ]}
      rowActions={(r) =>
        r.status === "converted"
          ? [{ label: "Open lead", href: `/staff/leads/${r.id}` }]
          : [
              { label: "Open lead", href: `/staff/leads/${r.id}` },
              { type: "separator" },
              { label: "Mark contacted", icon: <PhoneCall />, onSelect: () => set(r.id, "contacted"), disabled: r.status === "contacted" },
              { label: "Mark qualified", icon: <Star />, onSelect: () => set(r.id, "qualified"), disabled: r.status === "qualified" },
              { label: "Mark lost", icon: <UserX />, danger: true, onSelect: () => set(r.id, "lost"), disabled: r.status === "lost" },
            ]
      }
      empty={{ title: "No leads yet", body: "Website inquiries arrive here automatically. You can also add a lead manually.", icon: <Funnel /> }}
    />
  );
}
