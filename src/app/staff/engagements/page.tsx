import type { Metadata } from "next";
import { getDb } from "@/db";
import { EngagementsTable } from "@/components/engagements-table";
import { ButtonLink, PageHeader, SegmentedLinks } from "@/components/ui";
import { requireStaffActor } from "@/lib/auth/current";
import { firmToday } from "@/services/dashboard";
import { listOpenEngagements } from "@/services/engagements";

export const metadata: Metadata = { title: "Projects & Engagements" };

export default async function EngagementsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const actor = await requireStaffActor();
  const mine = (await searchParams).view === "mine";
  const items = await listOpenEngagements(getDb(), actor, { ownedByMe: mine });

  return (
    <>
      <PageHeader
        title="Projects & Engagements"
        description="Open tax, bookkeeping and advisory engagements across the firm."
        actions={
          <>
            <SegmentedLinks
              label="Scope"
              items={[
                { href: "/staff/engagements", label: "All I can access", active: !mine },
                { href: "/staff/engagements?view=mine", label: "I own", active: mine },
              ]}
            />
            <ButtonLink href="/staff/clients" variant="secondary">Start from a client</ButtonLink>
          </>
        }
      />
      <EngagementsTable
        rows={items.map((e) => ({ ...e, openTasks: e.openTaskCount }))}
        today={firmToday()}
        bulkStatuses={["in_progress", "waiting_on_client", "in_review", "completed"]}
        emptyTitle={mine ? "You don’t own any open engagements" : "No open engagements"}
        emptyBody="Engagements are created from a client’s profile."
      />
    </>
  );
}
