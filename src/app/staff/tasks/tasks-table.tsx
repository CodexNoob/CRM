"use client";

import { useRouter } from "next/navigation";
import { Briefcase, CircleCheck, RotateCcw, SquareCheckBig, Users } from "lucide-react";
import { bulkTaskStatusAction } from "@/app/actions/bulk";
import { CellTitle, DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui";
import { formatDate } from "@/lib/labels";
import { dueLabel } from "@/lib/status";

export interface TaskRowData {
  id: string;
  title: string;
  status: "open" | "done";
  isClientTask: boolean;
  dueDate: string | null;
  assigneeName: string | null;
  engagementId: string;
  engagementTitle: string;
  clientId: string;
  clientName: string;
}

export function TasksTable({ rows, today, done }: { rows: TaskRowData[]; today: string; done?: boolean }) {
  const router = useRouter();
  const assignees = [...new Set(rows.map((r) => r.assigneeName ?? "Unassigned"))].sort();
  return (
    <DataTable
      label="Tasks"
      rows={rows}
      getId={(r) => r.id}
      rowHref={(r) => `/staff/engagements/${r.engagementId}`}
      initialSort={{ id: "due", dir: "asc" }}
      search={{ placeholder: "Search tasks, clients, engagements", text: (r) => `${r.title} ${r.clientName} ${r.engagementTitle}` }}
      filters={[
        { id: "kind", label: "Type", options: [{ value: "client", label: "Client requests" }, { value: "internal", label: "Internal" }], match: (r, v) => (v === "client" ? r.isClientTask : !r.isClientTask) },
        ...(assignees.length > 1 ? [{ id: "who", label: "Assignee", options: assignees.map((a) => ({ value: a, label: a })), match: (r: TaskRowData, v: string) => (r.assigneeName ?? "Unassigned") === v }] : []),
        { id: "due", label: "Due", options: [{ value: "overdue", label: "Overdue" }, { value: "week", label: "Next 7 days" }, { value: "none", label: "No date" }], match: (r, v) => {
          if (v === "none") return !r.dueDate;
          if (!r.dueDate) return false;
          const d = dueLabel(r.dueDate, today);
          return v === "overdue" ? d.tone === "danger" : d.tone !== "danger" && d.tone !== "neutral";
        } },
      ]}
      bulkActions={done ? [{ label: "Reopen", icon: <RotateCcw />, run: (ids) => bulkTaskStatusAction(ids, "open") }] : [{ label: "Mark complete", icon: <CircleCheck />, run: (ids) => bulkTaskStatusAction(ids, "done") }]}
      columns={[
        { id: "title", header: "Task", sort: (r) => r.title.toLowerCase(), cell: (r) => <CellTitle title={r.title} sub={r.engagementTitle} href={`/staff/engagements/${r.engagementId}`} /> },
        { id: "client", header: "Client", sort: (r) => r.clientName.toLowerCase(), hideBelow: "sm", cell: (r) => <span className="text-ink">{r.clientName}</span> },
        { id: "who", header: "Assigned to", sort: (r) => (r.isClientTask ? "~client" : (r.assigneeName ?? "~")), hideBelow: "md", cell: (r) => (r.isClientTask ? <Badge tone="warn">Client request</Badge> : <span className="text-muted">{r.assigneeName ?? "Unassigned"}</span>) },
        {
          id: "due",
          header: "Due",
          sort: (r) => r.dueDate,
          cell: (r) => {
            if (done) return <span className="tabular text-muted">{formatDate(r.dueDate)}</span>;
            const d = dueLabel(r.dueDate, today);
            return (
              <div className="whitespace-nowrap">
                <div className="tabular text-ink">{r.dueDate ? formatDate(r.dueDate) : "—"}</div>
                {r.dueDate ? <div className={d.tone === "danger" ? "text-[12px] font-medium text-danger-ink" : d.tone === "warn" ? "text-[12px] text-warning-ink" : "text-[12px] text-muted"}>{d.text}</div> : null}
              </div>
            );
          },
        },
      ]}
      rowActions={(r) => [
        done
          ? { label: "Reopen task", icon: <RotateCcw />, onSelect: () => void bulkTaskStatusAction([r.id], "open").then(() => router.refresh()) }
          : { label: "Mark complete", icon: <CircleCheck />, onSelect: () => void bulkTaskStatusAction([r.id], "done").then(() => router.refresh()) },
        { type: "separator" },
        { label: "Open engagement", icon: <Briefcase />, href: `/staff/engagements/${r.engagementId}` },
        { label: "Open client", icon: <Users />, href: `/staff/clients/${r.clientId}` },
      ]}
      empty={{ title: done ? "No completed tasks" : "No open tasks", body: "Add tasks from an engagement. Client requests appear in the client’s portal.", icon: <SquareCheckBig /> }}
    />
  );
}
