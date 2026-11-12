import type { Metadata } from "next";
import { TASK_OPEN } from "@/lib/status";
import { getDb } from "@/db";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireClientActor } from "@/lib/auth/current";
import { formatDate, PORTAL_STATUS, SERVICE_LABELS } from "@/lib/labels";
import { getPortalOverview } from "@/services/portal";
import { listPortalAppointments } from "@/services/calendar";
import { APPOINTMENT_KIND_LABELS } from "@/lib/labels";
import { formatDateTime, formatTime } from "@/lib/time";
import { CompleteTaskButton } from "./complete-task-button";

export const metadata: Metadata = { title: "Your work" };

export default async function PortalHome() {
  const actor = await requireClientActor();
  const [overview, appts] = await Promise.all([getPortalOverview(getDb(), actor), listPortalAppointments(getDb(), actor)]);
  const openTasks = overview.engagements.reduce((n, e) => n + e.tasks.filter((t) => TASK_OPEN.includes(t.status)).length, 0);

  return (
    <>
      <PageHeader
        title={`Welcome, ${actor.name}`}
        description={
          openTasks
            ? `You have ${openTasks} item${openTasks === 1 ? "" : "s"} to complete.`
            : "You have nothing to do right now. We’ll let you know if we need anything."
        }
      />
      {appts.length ? (
        <Card title="Upcoming appointments" className="mb-4">
          <ul className="-my-2 divide-y divide-line">
            {appts.map((a) => (
              <li key={a.id} className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-sm font-medium text-ink">{a.title}</span>
                <span className="text-sm text-muted">
                  {formatDateTime(a.startsAt)}–{formatTime(a.endsAt)} · {APPOINTMENT_KIND_LABELS[a.kind]} with {a.withName}
                  {a.location ? ` · ${a.location}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {overview.engagements.length === 0 ? (
        <EmptyState title="No active work yet.">When your firm starts work for you, it will appear here.</EmptyState>
      ) : (
        <div className="space-y-4">
          {overview.engagements.map((e) => {
            const status = PORTAL_STATUS[e.status];
            return (
              <Card key={e.id}>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <h2 className="text-lg font-semibold wrap-break-word">{e.title}</h2>
                    <p className="text-sm text-muted">
                      {SERVICE_LABELS[e.serviceType]}
                      {e.taxYear ? ` · Tax year ${e.taxYear}` : ""}
                      {e.dueDate ? ` · Target date ${formatDate(e.dueDate)}` : ""}
                    </p>
                  </div>
                  <Badge tone={e.status === "waiting_on_client" ? "warn" : e.status === "completed" || e.status === "filed" ? "good" : "brand"}>
                    {status.label}
                  </Badge>
                </div>
                <p className="mt-3 text-sm">{status.description}</p>
                <p className="mt-1 text-xs text-muted">Your contact: {e.contactName}</p>

                <h3 className="mt-5 mb-2 text-sm font-semibold">Your to-do items</h3>
                {e.tasks.length ? (
                  <ul className="divide-y divide-line rounded-md border border-line">
                    {e.tasks.map((t) => (
                      <li key={t.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <p className={t.status === "completed" ? "text-sm text-muted line-through" : "text-sm"}>{t.title}</p>
                          {t.dueDate ? <p className="text-xs text-muted">Due {formatDate(t.dueDate)}</p> : null}
                        </div>
                        {t.status === "completed" ? <Badge tone="good">Done</Badge> : <CompleteTaskButton taskId={t.id} />}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted">Nothing needed from you for this one.</p>
                )}
              </Card>
            );
          })}
        </div>
      )}
      <p className="mt-8 text-xs text-muted">
        Please don’t email tax documents. Use the Documents tab to send them securely, and Messages to reach your contact.
      </p>
    </>
  );
}
