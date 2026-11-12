import type { Metadata } from "next";
import { getDb } from "@/db";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { requirePortalContext } from "@/lib/auth/portal-context";
import { formatDate, PORTAL_STATUS, SERVICE_LABELS } from "@/lib/labels";
import { listPortalServices } from "@/services/portal";

export const metadata: Metadata = { title: "My Services" };
export const dynamic = "force-dynamic";

const SERVICE_DESCRIPTIONS: Record<string, string> = {
  individual_tax: "Preparation and filing of your individual income tax return.",
  business_tax: "Preparation and filing of your business income tax return.",
  tax_consulting: "Tax planning and advice for decisions and changes.",
  bookkeeping: "Recording, categorizing and reconciling your business transactions.",
  accounting: "Financial statements and reporting.",
  other: "Professional services agreed with the firm.",
};

export default async function PortalServicesPage() {
  const { actor, client } = await requirePortalContext();
  const { services, accountManager, firm } = await listPortalServices(getDb(), actor, client.clientId);
  const active = services.filter((s) => !["completed", "filed", "closed"].includes(s.status));
  const past = services.filter((s) => ["completed", "filed", "closed"].includes(s.status));

  return (
    <>
      <PageHeader title="My Services" description={`What ${firm.name || "the firm"} is doing for ${client.name}.`} />
      <div className="grid gap-4 md:grid-cols-[1fr_16rem]">
        <div className="space-y-4">
          {active.length === 0 ? (
            <EmptyState title="No active services">When the firm starts work for you, it will appear here.</EmptyState>
          ) : (
            active.map((s) => {
              const status = PORTAL_STATUS[s.status];
              return (
                <Card key={s.id}>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <h2 className="text-lg font-semibold wrap-break-word">{s.title}</h2>
                      <p className="text-sm text-muted">
                        {SERVICE_LABELS[s.serviceType]}
                        {s.taxYear ? ` · Tax year ${s.taxYear}` : ""}
                        {s.periodStart && s.periodEnd ? ` · ${formatDate(s.periodStart)} – ${formatDate(s.periodEnd)}` : ""}
                      </p>
                    </div>
                    <Badge tone={s.status === "waiting_on_client" || s.status === "awaiting_acceptance" ? "warn" : "brand"}>{status.label}</Badge>
                  </div>
                  <p className="mt-3 text-sm text-ink">{s.description || SERVICE_DESCRIPTIONS[s.serviceType]}</p>
                  <p className="mt-1 text-sm text-muted">{status.description}</p>
                  {s.progressPercent !== null ? (
                    <div className="mt-4">
                      <div className="flex justify-between text-xs text-muted">
                        <span>Progress</span>
                        <span className="tabular">{s.progressPercent}%</span>
                      </div>
                      <div className="mt-1 h-2 overflow-hidden rounded-full bg-subtle" role="progressbar" aria-valuenow={s.progressPercent} aria-valuemin={0} aria-valuemax={100} aria-label={`${s.title} progress`}>
                        <div className="h-full bg-brand" style={{ width: `${s.progressPercent}%` }} />
                      </div>
                    </div>
                  ) : null}
                  <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
                    {s.startDate ? (
                      <div>
                        <dt className="text-xs text-muted">Started</dt>
                        <dd>{formatDate(s.startDate)}</dd>
                      </div>
                    ) : null}
                    {s.dueDate ? (
                      <div>
                        <dt className="text-xs text-muted">Target date</dt>
                        <dd>{formatDate(s.dueDate)}</dd>
                      </div>
                    ) : null}
                  </dl>
                </Card>
              );
            })
          )}
          {past.length ? (
            <Card title="Completed">
              <ul className="-my-1.5 divide-y divide-line">
                {past.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                    <span className="truncate">{s.title}</span>
                    <Badge tone="good">{PORTAL_STATUS[s.status].label}</Badge>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
        <Card title="Your contacts">
          <div className="space-y-3 text-sm">
            {accountManager ? (
              <div>
                <p className="text-xs text-muted">Account manager</p>
                <p className="font-medium text-ink">{accountManager.name}</p>
              </div>
            ) : null}
            <div>
              <p className="text-xs text-muted">{firm.name || "The firm"}</p>
              {firm.phone ? <p><a href={`tel:${firm.phone.replace(/[^0-9+]/g, "")}`} className="text-brand-ink hover:underline">{firm.phone}</a></p> : null}
              {firm.email ? <p className="break-all"><a href={`mailto:${firm.email}`} className="text-brand-ink hover:underline">{firm.email}</a></p> : null}
            </div>
            <p className="text-xs text-muted">For questions about a service, send a message from the Messages tab.</p>
          </div>
        </Card>
      </div>
    </>
  );
}
