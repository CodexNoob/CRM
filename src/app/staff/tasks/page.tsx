import type { Metadata } from "next";
import { getDb } from "@/db";
import { PageHeader, SegmentedLinks } from "@/components/ui";
import { requireStaffActor } from "@/lib/auth/current";
import { firmToday } from "@/services/dashboard";
import { listTasks } from "@/services/tasks";
import { TasksTable } from "./tasks-table";

export const metadata: Metadata = { title: "Tasks & Workflows" };

const VIEWS = ["mine", "all", "client", "done"] as const;

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const actor = await requireStaffActor();
  const v = (await searchParams).view;
  const view = (VIEWS as readonly string[]).includes(v ?? "") ? (v as (typeof VIEWS)[number]) : "mine";
  const rows = await listTasks(getDb(), actor, { mine: view === "mine", status: view === "done" ? "done" : "open" });
  const shown = view === "client" ? rows.filter((r) => r.isClientTask) : rows;

  return (
    <>
      <PageHeader
        title="Tasks & Workflows"
        description="Work items across every engagement you can access."
        actions={
          <SegmentedLinks
            label="Task view"
            items={[
              { href: "/staff/tasks", label: "Assigned to me", active: view === "mine" },
              { href: "/staff/tasks?view=all", label: "All open", active: view === "all" },
              { href: "/staff/tasks?view=client", label: "Client requests", active: view === "client" },
              { href: "/staff/tasks?view=done", label: "Completed", active: view === "done" },
            ]}
          />
        }
      />
      <TasksTable key={view} rows={shown} today={firmToday()} done={view === "done"} />
      <p className="mt-3 text-[12px] text-muted">Workflow templates and recurring tasks arrive with Automation Rules.</p>
    </>
  );
}
