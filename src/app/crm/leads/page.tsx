import type { Metadata } from "next";
import Link from "next/link";
import { Download } from "lucide-react";
import { getDb } from "@/db";
import { inputClass } from "@/components/form";
import { buttonClass, cx, PageHeader, SegmentedLinks } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { requireStaffActor } from "@/lib/auth/current";
import { LEAD_SOURCE_LABELS, LEAD_STATUS_LABELS, PRIORITY_LABELS, recordNumber } from "@/lib/labels";
import { firmToday } from "@/services/dashboard";
import { listStaff } from "@/services/engagements";
import { canExportLeads, countLeadsByStatus, listLeads } from "@/services/leads";
import { LEAD_STAGES, leadQuery, parseLeadFilters, type LeadSearchParams } from "./filters";
import { NewLeadButton } from "./lead-forms";
import { LeadPipeline } from "./lead-pipeline";
import { LeadsTable, type LeadRowData } from "./leads-table";

export const metadata: Metadata = { title: "Leads & Prospects" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function LeadsPage({ searchParams }: { searchParams: Promise<LeadSearchParams> }) {
  const actor = await requireStaffActor();
  const sp = await searchParams;
  const today = firmToday();
  const filters = parseLeadFilters(sp, today);
  const view = one(sp.view) === "pipeline" ? "pipeline" : "table";
  const db = getDb();
  const [leads, counts, staff] = await Promise.all([listLeads(db, actor, filters), countLeadsByStatus(db, actor), listStaff(db, actor)]);

  const total = LEAD_STAGES.reduce((n, s) => n + counts[s], 0);
  const decided = counts.converted + counts.lost;
  const conversion = decided ? Math.round((counts.converted / decided) * 100) : 0;
  const rows: LeadRowData[] = leads.map((l) => ({
    id: l.id,
    number: recordNumber("L", l.leadNumber),
    name: l.name,
    company: l.company,
    email: l.email,
    phone: l.phone,
    status: l.status,
    source: l.source,
    priority: l.priority,
    estimatedValueCents: l.estimatedValueCents,
    ownerName: l.ownerName,
    followUpDate: l.followUpDate,
    createdAt: l.createdAt.toISOString(),
    convertedClientId: l.convertedClientId,
  }));
  const canEdit = can(actor, "leads", "edit");
  const canDelete = can(actor, "leads", "delete");
  const filtered = ["q", "status", "source", "owner", "priority", "from", "to", "followup"].some((k) => one(sp[k]));
  const exportHref = `/api/leads/export${leadQuery(sp, { view: undefined })}`;

  return (
    <>
      <PageHeader
        title="Leads & Prospects"
        description="Prospects before they become clients. Website inquiries arrive here automatically."
        actions={
          <div className="flex flex-wrap gap-2">
            {canExportLeads(actor) ? (
              <a href={exportHref} className={buttonClass("secondary")}>
                <Download /> Export CSV
              </a>
            ) : null}
            {can(actor, "leads", "create") ? <NewLeadButton staff={staff.map((s) => ({ id: s.id, name: s.name }))} canAssign={can(actor, "leads", "assign")} meId={actor.userId} /> : null}
          </div>
        }
      />

      {/* Pipeline: each stage is a filter. */}
      <nav aria-label="Pipeline stages" className="mb-4 grid grid-cols-2 overflow-hidden rounded-lg border border-line bg-surface sm:grid-cols-5 xl:grid-cols-10">
        <Link href={leadQuery(sp, { status: undefined }) || "/crm/leads"} aria-current={!filters.status ? "page" : undefined} className={cx("border-b border-r border-line px-3 py-2.5 hover:bg-hover", !filters.status && "bg-brand-soft/50")}>
          <span className="block text-[12px] font-medium text-muted">All leads</span>
          <span className="tabular block text-[18px] font-semibold text-ink">{total}</span>
          <span className="block text-[11.5px] text-muted">{conversion}% won</span>
        </Link>
        {LEAD_STAGES.map((s) => (
          <Link
            key={s}
            href={`/crm/leads${leadQuery(sp, { status: s })}`}
            aria-current={filters.status === s ? "page" : undefined}
            className={cx("border-b border-r border-line px-3 py-2.5 hover:bg-hover", filters.status === s && "bg-brand-soft/50")}
          >
            <span className="block truncate text-[12px] font-medium text-muted">{LEAD_STATUS_LABELS[s]}</span>
            <span className={cx("tabular block text-[18px] font-semibold", s === "new" && counts.new ? "text-warning-ink" : "text-ink")}>{counts[s]}</span>
            <span className="block text-[11.5px] text-muted">{total ? Math.round((counts[s] / total) * 100) : 0}%</span>
          </Link>
        ))}
      </nav>

      {/* Filters: a plain GET form, so the URL holds the filters and reloads keep them. */}
      <form method="get" action="/crm/leads" className="mb-4 rounded-lg border border-line bg-surface p-3" aria-label="Filter leads">
        <input type="hidden" name="view" value={view} />
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-[minmax(12rem,1.5fr)_repeat(5,minmax(0,1fr))]">
          <label className="block">
            <span className="mb-1 block text-[12px] text-muted">Search</span>
            <input name="q" defaultValue={one(sp.q)} placeholder="Name, company, email, phone" className={inputClass} />
          </label>
          <FilterSelect name="status" label="Stage" value={one(sp.status)} options={[{ value: "open", label: "All open" }, ...LEAD_STAGES.map((s) => ({ value: s, label: LEAD_STATUS_LABELS[s] }))]} />
          <FilterSelect name="source" label="Source" value={one(sp.source)} options={Object.entries(LEAD_SOURCE_LABELS).map(([value, label]) => ({ value, label }))} />
          <FilterSelect name="owner" label="Assigned to" value={one(sp.owner)} options={[{ value: "none", label: "Unassigned" }, ...staff.map((s) => ({ value: s.id, label: s.name }))]} />
          <FilterSelect name="priority" label="Priority" value={one(sp.priority)} options={Object.entries(PRIORITY_LABELS).map(([value, label]) => ({ value, label }))} />
          <FilterSelect name="sort" label="Sort by" value={one(sp.sort) || "created"} options={[{ value: "created", label: "Newest first" }, { value: "follow_up", label: "Follow-up date" }]} noAll />
        </div>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="mb-1 block text-[12px] text-muted">Created from</span>
            <input type="date" name="from" defaultValue={one(sp.from)} className={cx(inputClass, "w-40")} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[12px] text-muted">to</span>
            <input type="date" name="to" defaultValue={one(sp.to)} className={cx(inputClass, "w-40")} />
          </label>
          <label className="flex h-9 items-center gap-2 text-[13px] text-ink sm:h-8">
            <input type="checkbox" name="followup" value="due" defaultChecked={one(sp.followup) === "due"} className="size-4 accent-brand" />
            Follow-up due
          </label>
          <div className="ml-auto flex gap-2">
            {filtered ? (
              <Link href={`/crm/leads${view === "pipeline" ? "?view=pipeline" : ""}`} className={buttonClass("ghost")}>
                Clear
              </Link>
            ) : null}
            <button type="submit" className={buttonClass("secondary")}>
              Apply
            </button>
          </div>
        </div>
      </form>

      <div className="mb-3 flex items-center justify-between gap-3">
        <SegmentedLinks
          label="View"
          items={[
            { href: `/crm/leads${leadQuery(sp, { view: undefined })}`, label: "Table", active: view === "table" },
            { href: `/crm/leads${leadQuery(sp, { view: "pipeline" })}`, label: "Pipeline", active: view === "pipeline" },
          ]}
        />
        <p className="text-[12.5px] text-muted" aria-live="polite">
          {rows.length} {rows.length === 1 ? "lead" : "leads"}
          {filtered ? " match the filters" : ""}
        </p>
      </div>

      {view === "pipeline" ? (
        <LeadPipeline rows={rows} today={today} canEdit={canEdit} canDelete={canDelete} />
      ) : (
        <LeadsTable key={leadQuery(sp)} rows={rows} today={today} canEdit={canEdit} canDelete={canDelete} />
      )}
    </>
  );
}

function FilterSelect({ name, label, value, options, noAll }: { name: string; label: string; value: string; options: { value: string; label: string }[]; noAll?: boolean }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] text-muted">{label}</span>
      <select name={name} defaultValue={value} className={cx(inputClass, "pr-7")}>
        {noAll ? null : <option value="">All</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
