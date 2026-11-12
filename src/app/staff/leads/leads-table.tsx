"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Archive, ArrowRight, Funnel, Leaf, PhoneCall, Star, UserX } from "lucide-react";
import { archiveLeadAction } from "@/app/actions/crm";
import { bulkLeadStatusAction } from "@/app/actions/bulk";
import type { LeadSource, LeadStatus, Priority } from "@/db/schema";
import { CellTitle, DataTable } from "@/components/data-table";
import type { MenuItem } from "@/components/menu";
import { useToast } from "@/components/toast";
import { Badge } from "@/components/ui";
import type { ActionState } from "@/lib/action-state";
import { formatDate, formatMoney, LEAD_SOURCE_LABELS, LEAD_STATUS_LABELS, PRIORITY_LABELS } from "@/lib/labels";
import { LEAD_TONE, PRIORITY_TONE } from "@/lib/status";
import { LEAD_STAGES, MOVABLE_STAGES } from "./filters";
import { LostReasonDialog, useLeadMover } from "./lead-forms";

export interface LeadRowData {
  id: string;
  number: string | null;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  status: LeadStatus;
  source: LeadSource;
  priority: Priority;
  estimatedValueCents: number | null;
  ownerName: string | null;
  followUpDate: string | null;
  createdAt: string;
  convertedClientId: string | null;
}

const dateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
const OPEN = new Set<LeadStatus>(["new", "contacted", "qualified", "consultation_scheduled", "proposal_sent", "negotiation", "nurture"]);

export function isFollowUpOverdue(r: { followUpDate: string | null; status: LeadStatus }, today: string) {
  return !!r.followUpDate && r.followUpDate < today && OPEN.has(r.status);
}

/** Row-menu entries: open, every stage move, archive. */
export function leadMenuItems(r: LeadRowData, move: (id: string, s: LeadStatus) => void, opts: { canEdit: boolean; canDelete: boolean; onArchive: (id: string) => void }): MenuItem[] {
  if (r.status === "converted") {
    return [
      { label: "Open lead", href: `/staff/leads/${r.id}` },
      ...(r.convertedClientId ? [{ label: "Open client", href: `/staff/clients/${r.convertedClientId}` } as MenuItem] : []),
    ];
  }
  return [
    { label: "Open lead", href: `/staff/leads/${r.id}` },
    ...(opts.canEdit
      ? ([
          { type: "separator" },
          { type: "label", label: "Move to" },
          ...MOVABLE_STAGES.map((s) => ({ label: LEAD_STATUS_LABELS[s], icon: <ArrowRight />, onSelect: () => move(r.id, s), disabled: r.status === s, danger: s === "lost" })),
        ] as MenuItem[])
      : []),
    ...(opts.canDelete ? ([{ type: "separator" }, { label: "Archive", icon: <Archive />, danger: true, onSelect: () => opts.onArchive(r.id) }] as MenuItem[]) : []),
  ];
}

export function useLeadArchiver() {
  const toast = useToast();
  const router = useRouter();
  return (id: string) => {
    if (!window.confirm("Archive this lead? It will be hidden from lists. Its history is kept.")) return;
    void archiveLeadAction(id, true).then((r) => {
      toast.fromState(r);
      router.refresh();
    });
  };
}

export function LeadsTable({ rows, today, canEdit, canDelete }: { rows: LeadRowData[]; today: string; canEdit: boolean; canDelete: boolean }) {
  const { move, dialog } = useLeadMover();
  const archive = useLeadArchiver();
  // Bulk "Lost" asks for one reason for all selected leads.
  const [lostIds, setLostIds] = useState<string[] | null>(null);
  const [resolveLost, setResolveLost] = useState<((s: ActionState) => void) | null>(null);
  const router = useRouter();

  return (
    <>
      {dialog}
      <LostReasonDialog
        open={!!lostIds}
        count={lostIds?.length ?? 1}
        onClose={() => {
          resolveLost?.({ status: "idle" });
          setLostIds(null);
        }}
        onConfirm={(reason) => {
          const ids = lostIds ?? [];
          setLostIds(null);
          void bulkLeadStatusAction(ids, "lost", reason).then((r) => {
            resolveLost?.(r);
            router.refresh();
          });
        }}
      />
      <DataTable
        label="Leads"
        rows={rows}
        getId={(r) => r.id}
        rowHref={(r) => `/staff/leads/${r.id}`}
        initialSort={{ id: "received", dir: "desc" }}
        bulkActions={
          canEdit
            ? [
                { label: "Contacted", icon: <PhoneCall />, run: (ids) => bulkLeadStatusAction(ids, "contacted") },
                { label: "Qualified", icon: <Star />, run: (ids) => bulkLeadStatusAction(ids, "qualified") },
                { label: "Nurture", icon: <Leaf />, run: (ids) => bulkLeadStatusAction(ids, "nurture") },
                {
                  label: "Lost…",
                  icon: <UserX />,
                  variant: "danger",
                  run: (ids) =>
                    new Promise<ActionState>((resolve) => {
                      setResolveLost(() => resolve);
                      setLostIds(ids);
                    }),
                },
              ]
            : undefined
        }
        columns={[
          {
            id: "name",
            header: "Lead",
            sort: (r) => r.name.toLowerCase(),
            cell: (r) => <CellTitle title={r.company ? `${r.name} · ${r.company}` : r.name} sub={[r.number, r.email ?? r.phone].filter(Boolean).join(" · ") || "No contact details"} href={`/staff/leads/${r.id}`} />,
          },
          { id: "status", header: "Stage", sort: (r) => LEAD_STAGES.indexOf(r.status), cell: (r) => <Badge tone={LEAD_TONE[r.status]} dot>{LEAD_STATUS_LABELS[r.status]}</Badge> },
          { id: "source", header: "Source", sort: (r) => r.source, hideBelow: "lg", cell: (r) => <span className="text-muted">{LEAD_SOURCE_LABELS[r.source]}</span> },
          {
            id: "priority",
            header: "Priority",
            sort: (r) => ["low", "normal", "high", "urgent"].indexOf(r.priority),
            hideBelow: "md",
            cell: (r) => (r.priority === "normal" ? <span className="text-muted">Normal</span> : <Badge tone={PRIORITY_TONE[r.priority]}>{PRIORITY_LABELS[r.priority]}</Badge>),
          },
          { id: "owner", header: "Assigned to", sort: (r) => r.ownerName ?? "~", hideBelow: "md", cell: (r) => <span className="text-muted">{r.ownerName ?? "Unassigned"}</span> },
          {
            id: "value",
            header: "Est. value",
            align: "right",
            sort: (r) => r.estimatedValueCents ?? -1,
            hideBelow: "lg",
            cell: (r) => (r.estimatedValueCents !== null ? <span className="tabular">{formatMoney(r.estimatedValueCents)}</span> : <span className="text-faint">—</span>),
          },
          {
            id: "follow",
            header: "Follow-up",
            sort: (r) => r.followUpDate,
            hideBelow: "sm",
            cell: (r) =>
              r.followUpDate ? (
                <span className={isFollowUpOverdue(r, today) ? "tabular font-medium text-danger-ink" : "tabular text-ink"}>
                  {formatDate(r.followUpDate)}
                  {isFollowUpOverdue(r, today) ? <span className="sr-only"> (overdue)</span> : null}
                </span>
              ) : (
                <span className="text-faint">—</span>
              ),
          },
          { id: "received", header: "Created", sort: (r) => r.createdAt, align: "right", hideBelow: "sm", cell: (r) => <span className="tabular text-muted">{dateFmt.format(new Date(r.createdAt))}</span> },
        ]}
        rowActions={(r) => leadMenuItems(r, move, { canEdit, canDelete, onArchive: archive })}
        empty={{ title: "No leads match", body: "Website inquiries arrive here automatically. Add a lead, or clear the filters.", icon: <Funnel /> }}
      />
    </>
  );
}
