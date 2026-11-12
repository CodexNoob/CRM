import type { Metadata } from "next";
import { getDb } from "@/db";
import type { EngagementStatus } from "@/db/schema";
import { EngagementsTable } from "@/components/engagements-table";
import { ButtonLink, PageHeader, SegmentedLinks, StatStrip } from "@/components/ui";
import { requireStaffActor } from "@/lib/auth/current";
import { firmToday } from "@/services/dashboard";
import { listWork, TAX_SERVICES } from "@/services/practice";

export const metadata: Metadata = { title: "Tax Returns" };

const OPEN: EngagementStatus[] = ["not_started", "waiting_on_client", "in_progress", "in_review", "ready_to_file", "on_hold"];

export default async function TaxReturnsPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const actor = await requireStaffActor();
  const type = (await searchParams).type;
  const services = type === "individual" ? (["individual_tax"] as const) : type === "business" ? (["business_tax"] as const) : TAX_SERVICES;
  const items = await listWork(getDb(), actor, { services: [...services] });
  const today = firmToday();
  const open = items.filter((i) => OPEN.includes(i.status));
  const overdue = open.filter((i) => i.dueDate && i.dueDate < today).length;

  return (
    <>
      <PageHeader
        title="Tax Returns"
        description="Individual and business returns by tax year and filing status."
        actions={
          <>
            <SegmentedLinks
              label="Return type"
              items={[
                { href: "/staff/tax-returns", label: "All", active: !type },
                { href: "/staff/tax-returns?type=individual", label: "Individual", active: type === "individual" },
                { href: "/staff/tax-returns?type=business", label: "Business", active: type === "business" },
              ]}
            />
            <ButtonLink href="/staff/tax-preparation" variant="secondary">Preparation board</ButtonLink>
          </>
        }
      />
      <StatStrip
        className="mb-5"
        items={[
          { label: "Returns in progress", value: open.length },
          { label: "Waiting on client", value: items.filter((i) => i.status === "waiting_on_client").length, tone: "warning" },
          { label: "In review / ready", value: items.filter((i) => i.status === "in_review" || i.status === "ready_to_file").length },
          { label: "Overdue", value: overdue, tone: overdue ? "danger" : "default" },
          { label: "Filed", value: items.filter((i) => i.status === "filed").length, tone: "success" },
          { label: "Total returns", value: items.length },
        ]}
      />
      <EngagementsTable
        label="Tax returns"
        rows={items}
        today={today}
        bulkStatuses={["in_progress", "in_review", "ready_to_file", "filed"]}
        emptyTitle="No tax returns"
        emptyBody="Create an engagement with the service “Individual tax return” or “Business tax return” from a client’s profile."
      />
    </>
  );
}
