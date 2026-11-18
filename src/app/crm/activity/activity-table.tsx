"use client";

import { Activity } from "lucide-react";
import { DataTable } from "@/components/data-table";
import { Badge, type Tone } from "@/components/ui";

export interface AuditRow {
  id: string;
  action: string;
  label: string;
  entityType: string;
  href: string | null;
  actorName: string | null;
  createdAt: string;
}

const fmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" });

function category(action: string): { label: string; tone: Tone } {
  if (action.startsWith("auth.login_failed") || action.includes("locked") || action.includes("rejected")) return { label: "Security", tone: "danger" };
  if (action.startsWith("auth.") || action.startsWith("setup.")) return { label: "Sign-in", tone: "info" };
  if (action.startsWith("staff.") || action.startsWith("settings.")) return { label: "Admin", tone: "brand" };
  if (action.startsWith("document.")) return { label: "Document", tone: "neutral" };
  return { label: "Record", tone: "neutral" };
}

export function ActivityTable({ rows }: { rows: AuditRow[] }) {
  const actors = [...new Set(rows.map((r) => r.actorName ?? "System"))].sort();
  return (
    <DataTable
      label="Audit log"
      rows={rows}
      getId={(r) => r.id}
      rowHref={(r) => r.href}
      initialSort={{ id: "when", dir: "desc" }}
      pageSize={50}
      search={{ placeholder: "Search events or people", text: (r) => `${r.label} ${r.actorName ?? "System"} ${r.entityType}` }}
      filters={[
        { id: "cat", label: "Category", options: ["Security", "Sign-in", "Admin", "Document", "Record"].map((c) => ({ value: c, label: c })), match: (r, v) => category(r.action).label === v },
        { id: "who", label: "Person", options: actors.map((a) => ({ value: a, label: a })), match: (r, v) => (r.actorName ?? "System") === v },
      ]}
      columns={[
        { id: "when", header: "Time", sort: (r) => r.createdAt, cell: (r) => <span className="tabular whitespace-nowrap text-muted">{fmt.format(new Date(r.createdAt))}</span> },
        { id: "who", header: "Person", sort: (r) => r.actorName ?? "~", cell: (r) => <span className="text-ink">{r.actorName ?? "System"}</span> },
        { id: "what", header: "Event", sort: (r) => r.label, cell: (r) => <span className="text-ink">{r.label}</span> },
        { id: "cat", header: "Category", sort: (r) => category(r.action).label, hideBelow: "sm", cell: (r) => { const c = category(r.action); return <Badge tone={c.tone} dot>{c.label}</Badge>; } },
        { id: "record", header: "Record", hideBelow: "md", cell: (r) => <span className="capitalize text-muted">{r.entityType}</span> },
      ]}
      empty={{ title: "No activity yet", icon: <Activity /> }}
    />
  );
}
