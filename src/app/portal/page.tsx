import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { requirePortalContext } from "@/lib/auth/portal-context";
import { APPOINTMENT_KIND_LABELS, formatDate, PORTAL_STATUS, SERVICE_LABELS } from "@/lib/labels";
import { formatDateTime, formatTime } from "@/lib/time";
import { listPortalAppointments } from "@/services/calendar";
import { firmToday } from "@/services/dashboard";
import { getPortalOverview, getPortalSummary } from "@/services/portal";
import { CompleteTaskButton } from "./complete-task-button";

export const metadata: Metadata = { title: "Overview" };
export const dynamic = "force-dynamic";

const KIND_LABEL = { engagement: "Service due", task: "Your to-do", document_request: "Documents due" } as const;

export default async function PortalHome() {
  const { actor, client } = await requirePortalContext();
  const db = getDb();
  const today = firmToday();
  // Older services authorize by actor.clientId — give them the server-resolved client.
  const scopedActor = { ...actor, clientId: client.clientId };
  const [summary, overview, appts] = await Promise.all([
    getPortalSummary(db, actor, client.clientId, today),
    getPortalOverview(db, actor, client.clientId),
    listPortalAppointments(db, scopedActor),
  ]);

  const tiles = [
    { label: "Active services", value: summary.activeEngagements, href: "/portal/services" },
    { label: "Documents requested", value: summary.outstandingDocumentItems, href: "/portal/documents", attention: summary.outstandingDocumentItems > 0 },
    { label: "Awaiting the firm’s review", value: summary.documentsAwaitingReview, href: "/portal/documents" },
    { label: "Signatures needed", value: summary.pendingSignatures, href: "/portal/signatures", attention: summary.pendingSignatures > 0, hidden: summary.pendingSignatures === 0 },
    { label: "Unread messages", value: summary.unreadMessages, href: "/portal/messages", attention: summary.unreadMessages > 0 },
    { label: "Your to-dos", value: summary.openClientTasks, href: "#todos", attention: summary.openClientTasks > 0 },
  ].filter((t) => !t.hidden);

  const needsYou = summary.outstandingDocumentItems + summary.pendingSignatures + summary.openClientTasks;

  return (
    <>
      <PageHeader
        title={`Welcome, ${actor.name}`}
        description={
          needsYou
            ? `There ${needsYou === 1 ? "is 1 item" : `are ${needsYou} items`} waiting for you${client.name ? ` for ${client.name}` : ""}.`
            : "Nothing needs your attention right now. We’ll let you know if we need anything."
        }
      />

      <dl className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {tiles.map((t) => (
          <Link key={t.label} href={t.href} className={"rounded-lg border bg-surface p-3 hover:border-brand " + (t.attention ? "border-warning/50" : "border-line")}>
            <dt className="text-xs text-muted">{t.label}</dt>
            <dd className="mt-1 text-xl font-semibold text-ink tabular">{t.value}</dd>
          </Link>
        ))}
      </dl>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Upcoming deadlines">
          {summary.deadlines.length ? (
            <ul className="-my-1.5 divide-y divide-line">
              {summary.deadlines.map((d) => (
                <li key={`${d.kind}-${d.id}`} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <Link href={d.href} className="min-w-0">
                    <span className="block truncate text-ink hover:underline">{d.title}</span>
                    <span className="text-xs text-muted">{KIND_LABEL[d.kind]}</span>
                  </Link>
                  <Badge tone={d.dueDate < today ? "danger" : "neutral"}>{d.dueDate < today ? `Overdue · ${formatDate(d.dueDate)}` : formatDate(d.dueDate)}</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No upcoming deadlines.</p>
          )}
        </Card>
        <Card title="Recent updates">
          {summary.recent.length ? (
            <ul className="-my-1.5 divide-y divide-line">
              {summary.recent.map((n) => (
                <li key={n.id} className="py-2 text-sm">
                  {n.href ? (
                    <Link href={n.href} className="text-ink hover:underline">
                      {n.title}
                    </Link>
                  ) : (
                    <span className="text-ink">{n.title}</span>
                  )}
                  <span className="block text-xs text-muted">{formatDateTime(n.createdAt)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No updates yet.</p>
          )}
        </Card>
      </div>

      {appts.length ? (
        <Card title="Upcoming appointments" className="mt-4">
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

      <h2 id="todos" className="mt-8 mb-3 text-base font-semibold text-ink">
        Your services and to-dos
      </h2>
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
                    <h3 className="text-lg font-semibold wrap-break-word">{e.title}</h3>
                    <p className="text-sm text-muted">
                      {SERVICE_LABELS[e.serviceType]}
                      {e.taxYear ? ` · Tax year ${e.taxYear}` : ""}
                      {e.dueDate ? ` · Target date ${formatDate(e.dueDate)}` : ""}
                    </p>
                  </div>
                  <Badge tone={e.status === "waiting_on_client" || e.status === "awaiting_acceptance" ? "warn" : e.status === "completed" || e.status === "filed" || e.status === "closed" ? "good" : "brand"}>
                    {status.label}
                  </Badge>
                </div>
                <p className="mt-3 text-sm">{status.description}</p>
                <p className="mt-1 text-xs text-muted">Your contact: {e.contactName}</p>

                <h4 className="mt-5 mb-2 text-sm font-semibold">Your to-do items</h4>
                {e.tasks.length ? (
                  <ul className="divide-y divide-line rounded-md border border-line">
                    {e.tasks.map((t) => (
                      <li key={t.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <p className={t.status === "completed" ? "text-sm text-muted line-through" : "text-sm"}>{t.title}</p>
                          {t.dueDate ? <p className="text-xs text-muted">Due {formatDate(t.dueDate)}</p> : null}
                        </div>
                        {t.status === "completed" ? <Badge tone="good">Done</Badge> : t.status === "cancelled" ? <Badge>Not needed</Badge> : <CompleteTaskButton taskId={t.id} />}
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
