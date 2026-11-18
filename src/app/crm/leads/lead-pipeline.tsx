"use client";

import Link from "next/link";
import { MoreHorizontal } from "lucide-react";
import { Menu } from "@/components/menu";
import { Badge, cx } from "@/components/ui";
import { formatDate, formatMoney, LEAD_STATUS_LABELS, PRIORITY_LABELS } from "@/lib/labels";
import { LEAD_TONE, PRIORITY_TONE } from "@/lib/status";
import { LEAD_STAGES } from "./filters";
import { useLeadMover } from "./lead-forms";
import { isFollowUpOverdue, leadMenuItems, useLeadArchiver, type LeadRowData } from "./leads-table";

/**
 * Kanban pipeline: one column per stage. Cards move with a keyboard-accessible
 * "Move to…" menu (no drag-and-drop). Converted cards link to their client.
 */
export function LeadPipeline({ rows, today, canEdit, canDelete }: { rows: LeadRowData[]; today: string; canEdit: boolean; canDelete: boolean }) {
  const { move, dialog, pending } = useLeadMover();
  const archive = useLeadArchiver();
  const byStage = new Map(LEAD_STAGES.map((s) => [s, [] as LeadRowData[]]));
  for (const r of rows) byStage.get(r.status)?.push(r);

  return (
    <>
      {dialog}
      <div className={cx("-mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0", pending && "opacity-70")} aria-busy={pending}>
        <ol className="flex min-w-max gap-3" aria-label="Lead pipeline">
          {LEAD_STAGES.map((stage) => {
            const cards = byStage.get(stage) ?? [];
            const value = cards.reduce((n, c) => n + (c.estimatedValueCents ?? 0), 0);
            return (
              <li key={stage} className="flex w-64 shrink-0 flex-col rounded-lg border border-line bg-subtle/60">
                <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
                  <h3 className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink">
                    <Badge tone={LEAD_TONE[stage]} dot>
                      {LEAD_STATUS_LABELS[stage]}
                    </Badge>
                  </h3>
                  <span className="text-[12px] tabular text-muted">
                    {cards.length}
                    {value ? ` · ${formatMoney(value)}` : ""}
                  </span>
                </div>
                <ul className="flex max-h-[65vh] flex-col gap-2 overflow-y-auto p-2" aria-label={`${LEAD_STATUS_LABELS[stage]}: ${cards.length} leads`}>
                  {cards.length === 0 ? <li className="px-1 py-3 text-center text-[12px] text-faint">No leads</li> : null}
                  {cards.map((r) => (
                    <li key={r.id} className="rounded-md border border-line bg-surface p-2.5 shadow-sm">
                      <div className="flex items-start justify-between gap-2">
                        <Link href={`/crm/leads/${r.id}`} className="min-w-0 text-[13px] font-medium text-ink hover:text-brand hover:underline">
                          <span className="block truncate">{r.name}</span>
                          {r.company ? <span className="block truncate text-[12px] font-normal text-muted">{r.company}</span> : null}
                        </Link>
                        <Menu
                          label={`Actions for ${r.name}`}
                          trigger={<MoreHorizontal className="size-4" />}
                          triggerClassName="-mr-1 -mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted hover:bg-subtle hover:text-ink"
                          items={leadMenuItems(r, move, { canEdit, canDelete, onArchive: archive })}
                        />
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
                        {r.number ? <span className="tabular">{r.number}</span> : null}
                        {r.estimatedValueCents !== null ? <span className="tabular text-ink">{formatMoney(r.estimatedValueCents)}</span> : null}
                        {r.priority !== "normal" ? <Badge tone={PRIORITY_TONE[r.priority]}>{PRIORITY_LABELS[r.priority]}</Badge> : null}
                      </div>
                      <div className="mt-1.5 flex items-center justify-between gap-2 text-[12px]">
                        <span className="truncate text-muted">{r.ownerName ?? "Unassigned"}</span>
                        {r.status === "converted" && r.convertedClientId ? (
                          <Link href={`/crm/clients/${r.convertedClientId}`} className="shrink-0 font-medium text-brand-ink hover:underline">
                            Client →
                          </Link>
                        ) : r.followUpDate ? (
                          <span className={cx("shrink-0 tabular", isFollowUpOverdue(r, today) ? "font-medium text-danger-ink" : "text-muted")}>
                            {isFollowUpOverdue(r, today) ? "Overdue " : "Follow up "}
                            {formatDate(r.followUpDate)}
                          </span>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ol>
      </div>
    </>
  );
}
