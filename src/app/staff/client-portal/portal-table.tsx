"use client";

import { MessageSquare, MonitorSmartphone, Users } from "lucide-react";
import { CellTitle, DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui";

export interface PortalRow {
  userId: string;
  name: string;
  email: string;
  isActive: boolean;
  hasPassword: boolean;
  clientId: string;
  clientName: string;
  lastSignIn: string | null;
  unreadFromClient: number;
  sharedDocuments: number;
}

const dateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
const state = (r: PortalRow) => (!r.isActive ? "deactivated" : r.hasPassword ? "active" : "invited");

export function PortalTable({ rows }: { rows: PortalRow[] }) {
  return (
    <DataTable
      label="Client portal logins"
      rows={rows}
      getId={(r) => r.userId}
      rowHref={(r) => `/staff/clients/${r.clientId}`}
      initialSort={{ id: "client", dir: "asc" }}
      search={{ placeholder: "Search person, email or client", text: (r) => `${r.name} ${r.email} ${r.clientName}` }}
      filters={[
        { id: "state", label: "Status", options: [{ value: "active", label: "Active" }, { value: "invited", label: "Invited" }, { value: "deactivated", label: "Deactivated" }], match: (r, v) => state(r) === v },
        { id: "unread", label: "Messages", options: [{ value: "unread", label: "Has unread" }], match: (r) => r.unreadFromClient > 0 },
      ]}
      columns={[
        { id: "person", header: "Portal user", sort: (r) => r.name.toLowerCase(), cell: (r) => <CellTitle title={r.name} sub={r.email} /> },
        { id: "client", header: "Client", sort: (r) => r.clientName.toLowerCase(), cell: (r) => <span className="text-ink">{r.clientName}</span> },
        {
          id: "status",
          header: "Status",
          sort: (r) => state(r),
          cell: (r) => <Badge tone={state(r) === "active" ? "good" : state(r) === "invited" ? "warn" : "neutral"} dot>{state(r) === "active" ? "Active" : state(r) === "invited" ? "Invited" : "Deactivated"}</Badge>,
        },
        { id: "last", header: "Last sign-in", sort: (r) => r.lastSignIn, hideBelow: "md", cell: (r) => <span className="tabular text-muted">{r.lastSignIn ? dateFmt.format(new Date(r.lastSignIn)) : "Never"}</span> },
        { id: "docs", header: "Shared files", align: "right", sort: (r) => r.sharedDocuments, hideBelow: "lg", cell: (r) => r.sharedDocuments },
        { id: "unread", header: "Unread", align: "right", sort: (r) => r.unreadFromClient, cell: (r) => (r.unreadFromClient ? <Badge tone="brand">{r.unreadFromClient}</Badge> : <span className="text-faint">0</span>) },
      ]}
      rowActions={(r) => [
        { label: "Open client", icon: <Users />, href: `/staff/clients/${r.clientId}` },
        { label: "Open conversation", icon: <MessageSquare />, href: `/staff/messages/${r.clientId}` },
        { label: "Manage portal access", icon: <MonitorSmartphone />, href: `/staff/clients/${r.clientId}` },
      ]}
      empty={{ title: "No portal logins yet", body: "Invite a client from their profile: Portal access → Create invitation link.", icon: <MonitorSmartphone /> }}
    />
  );
}
