import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db";
import type { LeadStatus } from "@/db/schema";
import { PageHeader, Panel, cx } from "@/components/ui";
import { requireStaffActor } from "@/lib/auth/current";
import { LEAD_STATUS_LABELS } from "@/lib/labels";
import { firmToday } from "@/services/dashboard";
import { countLeadsByStatus, listLeads } from "@/services/leads";
import { NewLeadForm } from "./lead-forms";
import { LeadsTable } from "./leads-table";

export const metadata: Metadata = { title: "Leads & Prospects" };

const STAGES: LeadStatus[] = ["new", "contacted", "qualified", "converted", "lost"];

export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const actor = await requireStaffActor();
  const sp = await searchParams;
  const stage = STAGES.find((s) => s === sp.status);
  const db = getDb();
  const [rows, counts] = await Promise.all([listLeads(db, actor, { status: stage }), countLeadsByStatus(db, actor)]);
  const total = STAGES.reduce((n, s) => n + counts[s], 0);
  const conversion = total ? Math.round((counts.converted / total) * 100) : 0;

  return (
    <>
      <PageHeader title="Leads & Prospects" description="Inquiries and prospects. Website inquiries arrive here automatically." />

      {/* Pipeline: each stage is a filter */}
      <nav aria-label="Pipeline stages" className="mb-5 grid grid-cols-2 overflow-hidden rounded-lg border border-line bg-surface sm:grid-cols-3 lg:grid-cols-6">
        <Link href="/staff/leads" aria-current={!stage ? "page" : undefined} className={cx("border-b border-r border-line px-4 py-3 hover:bg-hover", !stage && "bg-brand-soft/50")}>
          <span className="block text-[12px] font-medium text-muted">All leads</span>
          <span className="tabular block text-[20px] font-semibold text-ink">{total}</span>
          <span className="block text-[12px] text-muted">{conversion}% converted</span>
        </Link>
        {STAGES.map((s) => (
          <Link key={s} href={`/staff/leads?status=${s}`} aria-current={stage === s ? "page" : undefined} className={cx("border-b border-r border-line px-4 py-3 hover:bg-hover", stage === s && "bg-brand-soft/50")}>
            <span className="block text-[12px] font-medium text-muted">{LEAD_STATUS_LABELS[s]}</span>
            <span className={cx("tabular block text-[20px] font-semibold", s === "new" && counts.new ? "text-warning-ink" : "text-ink")}>{counts[s]}</span>
            <span className="block text-[12px] text-muted">{total ? Math.round((counts[s] / total) * 100) : 0}% of pipeline</span>
          </Link>
        ))}
      </nav>

      <div className="grid gap-5 xl:grid-cols-[1fr_20rem]">
        <LeadsTable key={stage ?? "all"} rows={rows.map((l) => ({ ...l, createdAt: l.createdAt.toISOString() }))} today={firmToday()} />
        <div id="new-lead" className="scroll-mt-20">
          <Panel title="Add a lead">
            <NewLeadForm />
          </Panel>
        </div>
      </div>
    </>
  );
}
