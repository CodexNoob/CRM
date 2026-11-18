import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CircleDashed, Plug } from "lucide-react";
import { Badge, ButtonLink, PageHeader, Panel } from "@/components/ui";
import { NavIcon } from "@/components/staff/icons";
import { findPlanned } from "@/components/staff/nav-config";
import { requireStaffActor } from "@/lib/auth/current";
import { can } from "@/lib/auth/permissions";

/**
 * Modules that depend on an external service that is not connected yet.
 * The page states that plainly and shows no placeholder data.
 */

export async function generateMetadata({ params }: { params: Promise<{ module: string }> }): Promise<Metadata> {
  const entry = findPlanned((await params).module);
  return { title: entry?.label ?? "Not found" };
}

export default async function PlannedModulePage({ params }: { params: Promise<{ module: string }> }) {
  const actor = await requireStaffActor();
  const entry = findPlanned((await params).module);
  if (!entry || (entry.adminOnly && actor.role !== "admin" && actor.role !== "super_admin") || (entry.module && !can(actor, entry.module, "view"))) notFound();
  const capabilities = entry.summary.split(",").map((s) => s.trim()).filter(Boolean);

  return (
    <>
      <PageHeader title={entry.label} description={entry.summary} meta={<Badge tone="neutral" dot>Coming soon</Badge>} />
      <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
        <Panel title="Status">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-line bg-subtle text-muted">
              <NavIcon name={entry.icon} />
            </span>
            <div className="min-w-0 text-[13px]">
              <p className="font-medium text-ink">{entry.slug === "payments" || entry.slug === "automation" ? "Coming soon" : "This module is not available yet"}</p>
              <p className="mt-1 text-muted">Nothing on this page is live, and no data is shown or stored here.</p>
              {entry.needs ? (
                <div className="mt-4 rounded-md border border-line bg-hover p-3">
                  <p className="text-[12px] font-medium uppercase tracking-wide text-faint">Required before it can be enabled</p>
                  <p className="mt-1 text-ink">{entry.needs}</p>
                </div>
              ) : null}
            </div>
          </div>
        </Panel>
        <div className="space-y-5">
          <Panel title="Planned capabilities">
            <ul className="space-y-2 text-[13px]">
              {capabilities.map((c) => (
                <li key={c} className="flex items-start gap-2 text-ink">
                  <CircleDashed className="mt-0.5 size-3.5 shrink-0 text-faint" aria-hidden />
                  <span className="first-letter:uppercase">{c}</span>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel title="Related">
            <div className="flex flex-col gap-2">
              <ButtonLink href="/crm/integrations" variant="secondary" className="justify-start"><Plug /> Integration status</ButtonLink>
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}
