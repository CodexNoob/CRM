import type { Metadata } from "next";
import { getDb } from "@/db";
import { EngagementsTable } from "@/components/engagements-table";
import { ButtonLink, PageHeader, StatStrip } from "@/components/ui";
import { requireStaffActor } from "@/lib/auth/current";
import { firmToday } from "@/services/dashboard";
import { BOOKKEEPING_SERVICES, listWork } from "@/services/practice";

export const metadata: Metadata = { title: "Bookkeeping" };

export default async function BookkeepingPage() {
  const actor = await requireStaffActor();
  const items = await listWork(getDb(), actor, { services: BOOKKEEPING_SERVICES });
  const today = firmToday();
  const open = items.filter((i) => i.status !== "completed" && i.status !== "filed");

  return (
    <>
      <PageHeader
        title="Bookkeeping"
        description="Monthly closes, reconciliations and accounting engagements."
        actions={<ButtonLink href="/staff/clients" variant="secondary">New engagement from a client</ButtonLink>}
      />
      <StatStrip
        className="mb-5"
        items={[
          { label: "Open engagements", value: open.length },
          { label: "Waiting on client", value: open.filter((i) => i.status === "waiting_on_client").length, tone: "warning" },
          { label: "Overdue", value: open.filter((i) => i.dueDate && i.dueDate < today).length, tone: open.some((i) => i.dueDate && i.dueDate < today) ? "danger" : "default" },
          { label: "Completed", value: items.length - open.length, tone: "success" },
        ]}
      />
      <EngagementsTable
        label="Bookkeeping engagements"
        rows={items}
        today={today}
        bulkStatuses={["in_progress", "waiting_on_client", "completed"]}
        emptyTitle="No bookkeeping engagements"
        emptyBody="Create an engagement with the service “Bookkeeping” or “Accounting” from a client’s profile. Recurring monthly work arrives with Automation Rules."
      />
    </>
  );
}
