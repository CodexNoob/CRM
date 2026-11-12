import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { getDb } from "@/db";
import { inputClass } from "@/components/form";
import { ButtonLink, buttonClass, PageHeader, SegmentedLinks } from "@/components/ui";
import type { EngagementStatus, ServiceType } from "@/db/schema";
import { requireStaffActor } from "@/lib/auth/current";
import { can } from "@/lib/auth/permissions";
import { SERVICE_LABELS, STATUS_LABELS } from "@/lib/labels";
import { listClients } from "@/services/clients";
import { firmToday } from "@/services/dashboard";
import { listEngagements, listStaff, type EngagementFilters } from "@/services/engagements";
import { EngagementBoard, EngagementListTable } from "./engagement-views";

export const metadata: Metadata = { title: "Projects & Engagements" };

type Search = { view?: string; scope?: string; q?: string; client?: string; service?: string; manager?: string; staff?: string; status?: string; year?: string; due?: string };

const GROUPS: { value: string; label: string }[] = [
  { value: "open", label: "All open" },
  { value: "pre_work", label: "Pre-work (proposal stage)" },
  { value: "done", label: "Finished (filed, completed, closed, cancelled)" },
];

export default async function EngagementsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const actor = await requireStaffActor();
  const sp = await searchParams;
  const db = getDb();
  const today = firmToday();
  const board = sp.view === "board";
  const mine = sp.scope === "mine";
  const statuses = engagementStatuses();
  const status = sp.status && (GROUPS.some((g) => g.value === sp.status) || statuses.includes(sp.status as EngagementStatus)) ? (sp.status as EngagementFilters["status"]) : "open";
  const filters: EngagementFilters = {
    q: sp.q,
    clientId: sp.client || undefined,
    serviceType: sp.service && sp.service in SERVICE_LABELS ? (sp.service as ServiceType) : undefined,
    managerId: sp.manager || undefined,
    staffId: sp.staff || undefined,
    status,
    taxYear: sp.year && /^\d{4}$/.test(sp.year) ? Number(sp.year) : undefined,
    due: sp.due === "overdue" || sp.due === "30d" ? sp.due : undefined,
    today,
    ownedByMe: mine,
  };
  const [rows, staff, clients] = await Promise.all([listEngagements(db, actor, filters), listStaff(db, actor), listClients(db, actor)]);
  const canCreate = can(actor, "engagements", "create");
  const canEdit = can(actor, "engagements", "edit");
  const canApprove = can(actor, "engagements", "approve");

  const keep = (over: Partial<Search>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...over })) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/staff/engagements?${s}` : "/staff/engagements";
  };
  const active = Object.entries(sp).some(([k, v]) => v && !["view", "scope"].includes(k));

  return (
    <>
      <PageHeader
        title="Projects & Engagements"
        description="Service arrangements with clients: scope, team, proposal, progress and deadlines."
        actions={
          <>
            <SegmentedLinks
              label="View"
              items={[
                { href: keep({ view: undefined }), label: "Table", active: !board },
                { href: keep({ view: "board" }), label: "Board", active: board },
              ]}
            />
            <SegmentedLinks
              label="Scope"
              items={[
                { href: keep({ scope: undefined }), label: "All I can access", active: !mine },
                { href: keep({ scope: "mine" }), label: "I manage", active: mine },
              ]}
            />
            {canCreate ? (
              <ButtonLink href="/staff/engagements/new">
                <Plus /> New engagement
              </ButtonLink>
            ) : null}
          </>
        }
      />

      <form method="get" action="/staff/engagements" className="mb-4 grid gap-2 rounded-lg border border-line bg-surface p-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8" aria-label="Filter engagements">
        {board ? <input type="hidden" name="view" value="board" /> : null}
        {mine ? <input type="hidden" name="scope" value="mine" /> : null}
        <Field label="Search" className="xl:col-span-2">
          <input name="q" defaultValue={sp.q} placeholder="Engagement or client" className={inputClass} />
        </Field>
        <Field label="Client">
          <select name="client" defaultValue={sp.client ?? ""} className={inputClass}>
            <option value="">Any client</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.displayName}</option>
            ))}
          </select>
        </Field>
        <Field label="Service">
          <select name="service" defaultValue={sp.service ?? ""} className={inputClass}>
            <option value="">Any service</option>
            {Object.entries(SERVICE_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </Field>
        <Field label="Manager">
          <select name="manager" defaultValue={sp.manager ?? ""} className={inputClass}>
            <option value="">Anyone</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Staff member">
          <select name="staff" defaultValue={sp.staff ?? ""} className={inputClass}>
            <option value="">Anyone</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Status">
          <select name="status" defaultValue={status ?? "open"} className={inputClass}>
            {GROUPS.map((g) => (
              <option key={g.value} value={g.value}>{g.label}</option>
            ))}
            <optgroup label="Exact status">
              {statuses.map((s) => (
                <option key={s} value={s}>{STATUS_LABELS[s]}</option>
              ))}
            </optgroup>
          </select>
        </Field>
        <Field label="Tax year / deadline">
          <div className="flex gap-2">
            <input name="year" defaultValue={sp.year} inputMode="numeric" placeholder="Year" aria-label="Tax year" className={inputClass + " w-20"} />
            <select name="due" defaultValue={sp.due ?? ""} aria-label="Deadline" className={inputClass}>
              <option value="">Any due date</option>
              <option value="overdue">Overdue</option>
              <option value="30d">Due in 30 days</option>
            </select>
          </div>
        </Field>
        <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-4 xl:col-span-8">
          <button type="submit" className={buttonClass("primary", undefined, "sm")}>Apply filters</button>
          {active ? (
            <Link href={keep({ q: undefined, client: undefined, service: undefined, manager: undefined, staff: undefined, status: undefined, year: undefined, due: undefined })} className={buttonClass("ghost", undefined, "sm")}>
              Clear
            </Link>
          ) : null}
          <span className="ml-auto text-[12px] text-muted">{rows.length} engagement{rows.length === 1 ? "" : "s"}</span>
        </div>
      </form>

      {board ? (
        <EngagementBoard rows={rows} today={today} canEdit={canEdit} canApprove={canApprove} />
      ) : (
        <EngagementListTable rows={rows} today={today} canEdit={canEdit} canApprove={canApprove} />
      )}
    </>
  );
}

function engagementStatuses(): EngagementStatus[] {
  return Object.keys(STATUS_LABELS) as EngagementStatus[];
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={"block space-y-1 " + (className ?? "")}>
      <span className="block text-[12px] font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}
