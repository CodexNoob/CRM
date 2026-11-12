"use client";

import { Briefcase, MessageSquare, Pencil, Users } from "lucide-react";
import { CellTitle, DataTable } from "@/components/data-table";
import { Badge, ButtonLink } from "@/components/ui";
import { CLIENT_STATUS_LABELS, CLIENT_TYPE_LABELS } from "@/lib/labels";
import { CLIENT_STATUS_TONE } from "@/lib/status";

export interface ClientRow {
  id: string;
  displayName: string;
  type: "individual" | "household" | "business";
  status: "prospect" | "active" | "inactive";
  email: string | null;
  phone: string | null;
  createdAt: string;
  openEngagements: number;
  team: string | null;
  portalUsers: number;
}

const dateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

export function ClientsTable({ rows, initialQuery }: { rows: ClientRow[]; initialQuery?: string }) {
  return (
    <DataTable
      key={initialQuery}
      label="Clients"
      rows={rows}
      getId={(r) => r.id}
      rowHref={(r) => `/staff/clients/${r.id}`}
      initialSort={{ id: "name", dir: "asc" }}
      search={{ placeholder: "Search name, email or phone", text: (r) => `${r.displayName} ${r.email ?? ""} ${r.phone ?? ""}` }}
      filters={[
        { id: "type", label: "Type", options: Object.entries(CLIENT_TYPE_LABELS).map(([value, label]) => ({ value, label })), match: (r, v) => r.type === v },
        { id: "status", label: "Status", options: Object.entries(CLIENT_STATUS_LABELS).map(([value, label]) => ({ value, label })), match: (r, v) => r.status === v },
        { id: "portal", label: "Portal", options: [{ value: "yes", label: "Has access" }, { value: "no", label: "No access" }], match: (r, v) => (v === "yes" ? r.portalUsers > 0 : r.portalUsers === 0) },
      ]}
      columns={[
        { id: "name", header: "Client", sort: (r) => r.displayName.toLowerCase(), cell: (r) => <CellTitle title={r.displayName} sub={r.email ?? r.phone ?? "No contact details"} href={`/staff/clients/${r.id}`} /> },
        { id: "type", header: "Type", sort: (r) => r.type, hideBelow: "sm", cell: (r) => <span className="text-muted">{CLIENT_TYPE_LABELS[r.type]}</span> },
        { id: "status", header: "Status", sort: (r) => r.status, cell: (r) => <Badge tone={CLIENT_STATUS_TONE[r.status]} dot>{CLIENT_STATUS_LABELS[r.status]}</Badge> },
        { id: "team", header: "Assigned team", sort: (r) => r.team, hideBelow: "lg", cell: (r) => <span className="text-muted">{r.team ?? "—"}</span> },
        { id: "portal", header: "Portal", sort: (r) => r.portalUsers, hideBelow: "md", cell: (r) => (r.portalUsers ? <Badge tone="good">Active</Badge> : <span className="text-faint">—</span>) },
        { id: "open", header: "Open work", align: "right", sort: (r) => r.openEngagements, cell: (r) => r.openEngagements },
        { id: "added", header: "Added", sort: (r) => r.createdAt, hideBelow: "lg", cell: (r) => <span className="tabular text-muted">{dateFmt.format(new Date(r.createdAt))}</span> },
      ]}
      rowActions={(r) => [
        { label: "Open client", icon: <Users />, href: `/staff/clients/${r.id}` },
        { label: "Edit details", icon: <Pencil />, href: `/staff/clients/${r.id}/edit` },
        { label: "New engagement", icon: <Briefcase />, href: `/staff/clients/${r.id}/engagements/new` },
        { label: "Message", icon: <MessageSquare />, href: `/staff/messages/${r.id}` },
      ]}
      empty={{ title: "No clients yet", body: "Add your first client, or convert a lead.", action: <ButtonLink href="/staff/clients/new">New client</ButtonLink>, icon: <Users /> }}
    />
  );
}
