import type { Metadata } from "next";
import { getDb } from "@/db";
import { SimpleTable, td } from "@/components/table";
import { Alert, PageHeader, Panel, StatStrip } from "@/components/ui";
import { requireStaffActor } from "@/lib/auth/current";
import { LEAD_SOURCE_LABELS, LEAD_STATUS_LABELS, SERVICE_LABELS, STATUS_LABELS } from "@/lib/labels";
import { getPracticeReport } from "@/services/practice";

export const metadata: Metadata = { title: "Financial Reports" };

/** Horizontal bars with the value printed beside each bar (one hue; text never relies on colour). */
function Bars({ rows, label }: { rows: { name: string; value: number }[]; label: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length || rows.every((r) => r.value === 0)) return <p className="text-[13px] text-muted">No data yet.</p>;
  return (
    <ul className="space-y-2.5" aria-label={label}>
      {rows.map((r) => (
        <li key={r.name} title={`${r.name}: ${r.value}`} className="grid grid-cols-[9rem_1fr_2.5rem] items-center gap-3 text-[12.5px]">
          <span className="truncate text-ink">{r.name}</span>
          <span className="h-1.5 rounded-sm bg-subtle">
            <span className="block h-1.5 rounded-sm bg-brand" style={{ width: `${(r.value / max) * 100}%` }} />
          </span>
          <span className="tabular text-right text-muted">{r.value}</span>
        </li>
      ))}
    </ul>
  );
}

export default async function ReportsPage() {
  const actor = await requireStaffActor();
  const r = await getPracticeReport(getDb(), actor);
  const totalLeads = r.leads.reduce((n, l) => n + l.count, 0);
  const converted = r.leads.find((l) => l.status === "converted")?.count ?? 0;

  return (
    <>
      <PageHeader title="Financial Reports" description="Practice performance from CRM data." />
      <div className="mb-5">
        <Alert tone="warning" title="Revenue reporting requires QuickBooks Online">
          Revenue, outstanding balances and payment history come from QuickBooks, which is not connected yet. No financial figures are shown until it is.
        </Alert>
      </div>
      <h2 className="mb-2 text-[12px] font-medium uppercase tracking-wide text-faint">Last 30 days</h2>
      <StatStrip
        className="mb-5"
        items={[
          { label: "New clients", value: r.last30.newClients },
          { label: "Engagements completed", value: r.last30.engagementsCompleted, tone: "success" },
          { label: "Documents received", value: r.last30.documentsUploaded },
          { label: "Messages exchanged", value: r.last30.messages },
        ]}
      />
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Open engagements by service">
          <Bars label="Open engagements by service" rows={r.byService.map((s) => ({ name: SERVICE_LABELS[s.serviceType], value: s.open }))} />
        </Panel>
        <Panel title="Engagements by status">
          <Bars label="Engagements by status" rows={r.byStatus.map((s) => ({ name: STATUS_LABELS[s.status], value: s.count })).sort((a, b) => b.value - a.value)} />
        </Panel>
        <Panel title="Lead pipeline" description={`${totalLeads ? Math.round((converted / totalLeads) * 100) : 0}% conversion · ${converted} of ${totalLeads} leads`}>
          <Bars label="Leads by stage" rows={(["new", "contacted", "qualified", "converted", "lost"] as const).map((s) => ({ name: LEAD_STATUS_LABELS[s], value: r.leads.find((l) => l.status === s)?.count ?? 0 }))} />
        </Panel>
        <Panel title="Lead sources" flush>
          {r.leadSources.length ? (
            <SimpleTable label="Lead sources" headers={[{ label: "Source" }, { label: "Leads", align: "right" }, { label: "Share", align: "right" }]}>
              {[...r.leadSources].sort((a, b) => b.count - a.count).map((s) => (
                <tr key={s.source}>
                  <td className={`${td} text-ink`}>{LEAD_SOURCE_LABELS[s.source as keyof typeof LEAD_SOURCE_LABELS] ?? s.source}</td>
                  <td className={`${td} tabular text-right`}>{s.count}</td>
                  <td className={`${td} tabular text-right text-muted`}>{totalLeads ? Math.round((s.count / totalLeads) * 100) : 0}%</td>
                </tr>
              ))}
            </SimpleTable>
          ) : (
            <p className="p-4 text-[13px] text-muted">No leads yet.</p>
          )}
        </Panel>
      </div>
    </>
  );
}
