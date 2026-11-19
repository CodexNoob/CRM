"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRightLeft, Briefcase, MoreHorizontal, Users } from "lucide-react";
import { setEngagementStatusAction } from "@/app/actions/engagements";
import type { EngagementStatus, ServiceType } from "@/db/schema";
import { CellTitle, DataTable } from "@/components/data-table";
import { Menu, type MenuItem } from "@/components/menu";
import { useToast } from "@/components/toast";
import { Badge, cx } from "@/components/ui";
import { formatDate, formatMoney, PROPOSAL_STATUS_LABELS, recordNumber, SERVICE_LABELS, STATUS_LABELS } from "@/lib/labels";
import { dueLabel, ENGAGEMENT_DONE, ENGAGEMENT_TONE } from "@/lib/status";

export interface EngagementListRow {
  id: string;
  engagementNumber: number | null;
  title: string;
  status: EngagementStatus;
  serviceType: ServiceType;
  taxYear: number | null;
  dueDate: string | null;
  proposalStatus: "not_required" | "draft" | "sent" | "accepted" | "declined";
  feeCents: number | null;
  clientId: string;
  clientName: string;
  ownerName: string;
  totalTaskCount: number;
  completedTaskCount: number;
  overdueTaskCount: number;
}

/** Statuses a user may move an engagement to from a menu (approval ones only with approve permission). */
const MOVE_TARGETS: EngagementStatus[] = ["draft", "proposal_sent", "awaiting_acceptance", "active", "not_started", "in_progress", "waiting_on_client", "in_review", "ready_to_file", "filed", "on_hold", "completed", "cancelled", "closed"];
const APPROVAL: EngagementStatus[] = ["completed", "cancelled", "closed"];

export function useStatusMove() {
  const router = useRouter();
  const toast = useToast();
  return async (id: string, status: EngagementStatus) => {
    if ((status === "cancelled" || status === "closed") && !window.confirm(status === "closed" ? "Close this engagement? Closed engagements can’t be reopened." : "Cancel this engagement?")) return;
    toast.fromState(await setEngagementStatusAction(id, status));
    router.refresh();
  };
}

export function moveItems(current: EngagementStatus, canApprove: boolean, onMove: (s: EngagementStatus) => void): MenuItem[] {
  return MOVE_TARGETS.filter((s) => s !== current && (canApprove || !APPROVAL.includes(s)) && current !== "closed").map((s) => ({
    label: STATUS_LABELS[s],
    icon: <ArrowRightLeft />,
    danger: s === "cancelled",
    onSelect: () => onMove(s),
  }));
}

function Progress({ done, total }: { done: number; total: number }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="min-w-24">
      <div className="text-[12px] text-muted tabular">{total ? `${done}/${total} tasks` : "No tasks"}</div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-subtle" aria-hidden>
        <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function EngagementListTable({ rows, today, canEdit, canApprove, canViewBilling }: { rows: EngagementListRow[]; today: string; canEdit: boolean; canApprove: boolean; canViewBilling: boolean }) {
  const move = useStatusMove();
  return (
    <DataTable
      label="Engagements"
      rows={rows}
      getId={(r) => r.id}
      rowHref={(r) => `/crm/engagements/${r.id}`}
      initialSort={{ id: "due", dir: "asc" }}
      search={{ placeholder: "Filter these results", text: (r) => `${r.title} ${r.clientName} ${r.ownerName} ${recordNumber("E", r.engagementNumber) ?? ""}` }}
      columns={[
        {
          id: "title",
          header: "Engagement",
          sort: (r) => r.title.toLowerCase(),
          cell: (r) => <CellTitle title={r.title} sub={[recordNumber("E", r.engagementNumber), r.taxYear ? `Tax year ${r.taxYear}` : null].filter(Boolean).join(" · ") || SERVICE_LABELS[r.serviceType]} href={`/crm/engagements/${r.id}`} />,
        },
        { id: "client", header: "Client", sort: (r) => r.clientName.toLowerCase(), cell: (r) => <span className="text-ink">{r.clientName}</span> },
        { id: "service", header: "Service", sort: (r) => r.serviceType, hideBelow: "lg", cell: (r) => <span className="text-muted">{SERVICE_LABELS[r.serviceType]}</span> },
        { id: "manager", header: "Manager", sort: (r) => r.ownerName, hideBelow: "md", cell: (r) => <span className="text-muted">{r.ownerName}</span> },
        {
          id: "status",
          header: "Status",
          sort: (r) => r.status,
          cell: (r) => (
            <div className="flex flex-col items-start gap-1">
              <Badge tone={ENGAGEMENT_TONE[r.status]} dot>{STATUS_LABELS[r.status]}</Badge>
              {r.proposalStatus !== "not_required" && r.proposalStatus !== "accepted" ? <Badge tone="warn">Proposal {PROPOSAL_STATUS_LABELS[r.proposalStatus].toLowerCase()}</Badge> : null}
            </div>
          ),
        },
        { id: "progress", header: "Progress", sort: (r) => (r.totalTaskCount ? r.completedTaskCount / r.totalTaskCount : -1), hideBelow: "sm", cell: (r) => <Progress done={r.completedTaskCount} total={r.totalTaskCount} /> },
        {
          id: "due",
          header: "Due",
          sort: (r) => r.dueDate,
          cell: (r) => {
            const d = dueLabel(r.dueDate, today);
            const done = ENGAGEMENT_DONE.includes(r.status);
            return (
              <div className="whitespace-nowrap">
                <div className="tabular text-ink">{formatDate(r.dueDate)}</div>
                {!done && r.dueDate ? <div className={d.tone === "danger" ? "text-[12px] font-medium text-danger-ink" : d.tone === "warn" ? "text-[12px] text-warning-ink" : "text-[12px] text-muted"}>{d.text}</div> : null}
                {r.overdueTaskCount ? <div className="text-[12px] text-danger-ink">{r.overdueTaskCount} overdue task{r.overdueTaskCount === 1 ? "" : "s"}</div> : null}
              </div>
            );
          },
        },
        ...(canViewBilling ? [{ id: "fee", header: "Fee", align: "right" as const, sort: (r: EngagementListRow) => r.feeCents ?? -1, hideBelow: "lg" as const, cell: (r: EngagementListRow) => <span className="tabular">{r.feeCents !== null ? formatMoney(r.feeCents) : "—"}</span> }] : []),
      ]}
      rowActions={(r) => [
        { label: "Open engagement", icon: <Briefcase />, href: `/crm/engagements/${r.id}` },
        { label: "Open client", icon: <Users />, href: `/crm/clients/${r.clientId}` },
        ...(canEdit && r.status !== "closed" ? [{ type: "separator" as const }, { type: "label" as const, label: "Move to" }, ...moveItems(r.status, canApprove, (s) => void move(r.id, s))] : []),
      ]}
      empty={{ title: "No engagements match", body: "Change the filters, or create an engagement from a client’s profile.", icon: <Briefcase /> }}
    />
  );
}

/* ───────── Board (kanban) ───────── */

const COLUMNS: { key: string; label: string; statuses: EngagementStatus[] }[] = [
  { key: "pre", label: "Pre-work", statuses: ["draft", "proposal_sent", "awaiting_acceptance"] },
  { key: "active", label: "Active / not started", statuses: ["active", "not_started"] },
  { key: "progress", label: "In progress", statuses: ["in_progress"] },
  { key: "waiting", label: "Waiting on client", statuses: ["waiting_on_client"] },
  { key: "review", label: "Under review", statuses: ["in_review"] },
  { key: "filing", label: "Ready to file / filed", statuses: ["ready_to_file", "filed"] },
  { key: "hold", label: "On hold", statuses: ["on_hold"] },
  { key: "done", label: "Completed", statuses: ["completed", "closed", "cancelled"] },
];

export function EngagementBoard({ rows, today, canEdit, canApprove, canViewBilling }: { rows: EngagementListRow[]; today: string; canEdit: boolean; canApprove: boolean; canViewBilling: boolean }) {
  const move = useStatusMove();
  const [pending, setPending] = useState<string | null>(null);
  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
      <div className="flex min-w-max gap-3">
        {COLUMNS.map((col) => {
          const items = rows.filter((r) => col.statuses.includes(r.status));
          return (
            <section key={col.key} aria-label={col.label} className="flex w-64 shrink-0 flex-col rounded-lg border border-line bg-hover">
              <header className="flex items-center justify-between border-b border-line px-3 py-2">
                <h2 className="text-[12.5px] font-semibold text-ink">{col.label}</h2>
                <span className="text-[12px] text-muted tabular">{items.length}</span>
              </header>
              <ul className="flex flex-1 flex-col gap-2 p-2">
                {items.length === 0 ? <li className="px-1 py-3 text-center text-[12px] text-faint">Nothing here</li> : null}
                {items.map((r) => {
                  const d = dueLabel(r.dueDate, today);
                  return (
                    <li key={r.id} className={cx("rounded-md border border-line bg-surface p-2.5 shadow-sm", pending === r.id && "opacity-60")}>
                      <div className="flex items-start justify-between gap-2">
                        <Link href={`/crm/engagements/${r.id}`} className="min-w-0 text-[13px] font-medium text-ink hover:text-brand hover:underline">
                          {r.title}
                        </Link>
                        {canEdit && r.status !== "closed" ? (
                          <Menu
                            label={`Move ${r.title}`}
                            triggerClassName="-mr-1 -mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded text-muted hover:bg-subtle hover:text-ink"
                            trigger={<MoreHorizontal className="size-4" aria-hidden />}
                            items={[
                              { type: "label", label: "Move to" },
                              ...moveItems(r.status, canApprove, (s) => {
                                setPending(r.id);
                                void move(r.id, s).finally(() => setPending(null));
                              }),
                            ]}
                          />
                        ) : null}
                      </div>
                      <p className="mt-0.5 truncate text-[12px] text-muted">
                        {recordNumber("E", r.engagementNumber)} · {r.clientName}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {col.statuses.length > 1 ? <Badge tone={ENGAGEMENT_TONE[r.status]}>{STATUS_LABELS[r.status]}</Badge> : null}
                        {r.dueDate && !ENGAGEMENT_DONE.includes(r.status) ? <Badge tone={d.tone}>{d.text}</Badge> : null}
                      </div>
                      <div className="mt-2">
                        <Progress done={r.completedTaskCount} total={r.totalTaskCount} />
                      </div>
                      <p className="mt-1.5 text-[11.5px] text-muted">{r.ownerName}</p>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
