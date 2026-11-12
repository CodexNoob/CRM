import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db";
import type { EngagementStatus } from "@/db/schema";
import { PageHeader } from "@/components/ui";
import { requireStaffActor } from "@/lib/auth/current";
import { formatDate, SERVICE_LABELS, STATUS_LABELS } from "@/lib/labels";
import { firmToday } from "@/services/dashboard";
import { listWork, TAX_SERVICES } from "@/services/practice";

export const metadata: Metadata = { title: "Tax Preparation" };

/** The preparation pipeline. Move a return between stages by changing its status on the engagement page. */
const STAGES: { status: EngagementStatus; hint: string }[] = [
  { status: "not_started", hint: "Engagement signed, not begun" },
  { status: "waiting_on_client", hint: "Blocked on client items" },
  { status: "in_progress", hint: "Being prepared" },
  { status: "in_review", hint: "Reviewer sign-off" },
  { status: "ready_to_file", hint: "Client approval / e-file" },
  { status: "filed", hint: "Filed" },
];

export default async function TaxPreparationPage() {
  const actor = await requireStaffActor();
  const items = await listWork(getDb(), actor, { services: TAX_SERVICES });
  const today = firmToday();

  return (
    <>
      <PageHeader title="Tax Preparation" description="Every tax return by preparation stage. Open a return to move it to the next stage." />
      <div className="-mx-4 overflow-x-auto px-4 pb-2 lg:-mx-6 lg:px-6">
        <div className="grid min-w-[72rem] grid-cols-6 gap-3">
          {STAGES.map((stage) => {
            const col = items.filter((i) => i.status === stage.status);
            return (
              <section key={stage.status} className="flex flex-col rounded-lg border border-line bg-hover" aria-label={STATUS_LABELS[stage.status]}>
                <header className="flex items-start justify-between gap-2 border-b border-line px-3 py-2.5">
                  <div>
                    <h2 className="text-[13px] font-semibold text-ink">{STATUS_LABELS[stage.status]}</h2>
                    <p className="text-[11px] text-muted">{stage.hint}</p>
                  </div>
                  <span className="tabular rounded border border-line bg-surface px-1.5 text-[11.5px] font-medium leading-5 text-ink">{col.length}</span>
                </header>
                <ul className="flex-1 space-y-2 p-2">
                  {col.length === 0 ? <li className="px-1 py-6 text-center text-xs text-muted">Empty</li> : null}
                  {col.map((w) => {
                    const late = !!w.dueDate && w.dueDate < today && stage.status !== "filed";
                    return (
                      <li key={w.id}>
                        <Link href={`/staff/engagements/${w.id}`} className="block rounded-md border border-line bg-surface p-2.5 shadow-sm hover:border-line-strong">
                          <p className="text-[13px] font-medium text-ink">{w.clientName}</p>
                          <p className="text-[12px] text-muted">{w.title}</p>
                          <p className="mt-2 flex items-center justify-between gap-2 text-[11px]">
                            <span className="text-muted">{SERVICE_LABELS[w.serviceType].replace(" tax return", "")} · {w.ownerName.split(" ")[0]}</span>
                            <span className={late ? "font-medium text-danger-ink" : "text-muted"}>{w.dueDate ? formatDate(w.dueDate) : ""}</span>
                          </p>
                          {w.openTasks ? <p className="mt-1 text-[11px] text-muted">{w.openTasks} open task{w.openTasks === 1 ? "" : "s"}</p> : null}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      </div>
      <p className="mt-3 text-xs text-muted">On hold and completed returns are listed under Tax Returns.</p>
    </>
  );
}
