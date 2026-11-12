import type { Metadata } from "next";
import Link from "next/link";
import { Briefcase, CircleCheck, CreditCard, Mail, MessageSquare, Pencil, Phone, Plus, Receipt, Repeat } from "lucide-react";
import { getDb } from "@/db";
import { staffMessageAction, staffUploadAction } from "@/app/actions/phase1";
import { DocumentList, UploadForm } from "@/components/documents";
import { MessageThread } from "@/components/message-thread";
import { SimpleTable, td, tdHide } from "@/components/table";
import { Avatar, Badge, ButtonLink, DescriptionList, EmptyState, Panel, TabNav } from "@/components/ui";
import { NewInvoiceForm, NewSubscriptionForm } from "@/components/invoice-client";
import { InvoiceTable } from "@/components/invoice-table";
import { SubscriptionTable } from "@/components/subscription-table";
import { listClientSubscriptions } from "@/services/subscriptions";
import { seesAllClients, type Actor } from "@/lib/auth/actor";
import { requireStaffActor } from "@/lib/auth/current";
import { CLIENT_STATUS_LABELS, CLIENT_TYPE_LABELS, formatDate, ROLE_LABELS, SERVICE_LABELS, STATUS_LABELS } from "@/lib/labels";
import { orNotFound } from "@/lib/page-helpers";
import { CLIENT_STATUS_TONE, dueLabel, ENGAGEMENT_TONE } from "@/lib/status";
import { getClient } from "@/services/clients";
import { firmToday } from "@/services/dashboard";
import { listClientDocuments } from "@/services/documents";
import { listClientEngagements } from "@/services/engagements";
import { listClientInvoices, paypalProvider } from "@/services/invoices";
import { ACTIVITY_LABELS, getClientTeam, getLatestTaxEngagement, listClientActivity } from "@/services/insights";
import { getThread } from "@/services/messages";
import { listTasks } from "@/services/tasks";
import { listPortalUsers } from "@/services/users";
import { PortalInviteForm } from "./portal-invite-form";

export const metadata: Metadata = { title: "Client" };

const TABS = ["overview", "engagements", "tasks", "documents", "messages", "billing", "activity"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABELS: Record<Tab, string> = {
  overview: "Overview",
  engagements: "Engagements",
  tasks: "Tasks",
  documents: "Documents",
  messages: "Messages",
  billing: "Billing",
  activity: "Activity",
};
const timeFmt = new Intl.DateTimeFormat("en-US", { timeZone: process.env.FIRM_TIMEZONE || "America/New_York", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

export default async function ClientPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const actor = await requireStaffActor();
  const { id } = await params;
  const requested = (await searchParams).tab ?? "";
  const tab: Tab = (TABS as readonly string[]).includes(requested) ? (requested as Tab) : "overview";
  const db = getDb();
  const client = await orNotFound(getClient(db, actor, id));
  const [engagements, team, latestTax, portalUsers, openTasks] = await Promise.all([
    listClientEngagements(db, actor, id),
    getClientTeam(db, actor, id),
    getLatestTaxEngagement(db, actor, id),
    listPortalUsers(db, actor, id),
    listTasks(db, actor, { clientId: id }),
  ]);
  const today = firmToday();
  const openEngagements = engagements.filter((e) => e.status !== "completed" && e.status !== "filed");
  const base = `/staff/clients/${client.id}`;
  const portalActive = portalUsers.some((u) => u.isActive && u.hasPassword);

  const summary: [string, React.ReactNode][] = [
    ["Tax year", latestTax?.taxYear ?? "—"],
    ["Filing status", latestTax ? <Badge tone={ENGAGEMENT_TONE[latestTax.status]} dot>{STATUS_LABELS[latestTax.status]}</Badge> : "No tax return"],
    ["Assigned team", team.length ? team.map((t) => t.name).join(", ") : "—"],
    ["Open engagements", openEngagements.length],
    ["Portal access", portalActive ? <Badge tone="good">Active</Badge> : portalUsers.length ? <Badge tone="warn">Invited</Badge> : "None"],
  ];

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-line bg-surface">
        <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <Avatar name={client.displayName} size="lg" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-[18px] font-semibold leading-7 text-ink">{client.displayName}</h1>
                <Badge tone={CLIENT_STATUS_TONE[client.status]} dot>{CLIENT_STATUS_LABELS[client.status]}</Badge>
                <Badge>{CLIENT_TYPE_LABELS[client.type]}</Badge>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted">
                {client.email ? (
                  <a href={`mailto:${client.email}`} className="inline-flex items-center gap-1.5 hover:text-ink">
                    <Mail className="size-3.5" aria-hidden />
                    {client.email}
                  </a>
                ) : null}
                {client.phone ? (
                  <a href={`tel:${client.phone.replace(/[^0-9+]/g, "")}`} className="inline-flex items-center gap-1.5 hover:text-ink">
                    <Phone className="size-3.5" aria-hidden />
                    {client.phone}
                  </a>
                ) : null}
                <span>Client since {client.createdAt.toLocaleDateString("en-US", { month: "short", year: "numeric" })}</span>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <ButtonLink href={`${base}?tab=messages`} variant="secondary">
              <MessageSquare /> Message
            </ButtonLink>
            <ButtonLink href={`${base}/edit`} variant="secondary">
              <Pencil /> Edit
            </ButtonLink>
            <ButtonLink href={`${base}/engagements/new`}>
              <Plus /> New engagement
            </ButtonLink>
          </div>
        </div>
        <dl className="grid grid-cols-2 border-t border-line text-[13px] sm:grid-cols-3 lg:grid-cols-5">
          {summary.map(([k, v]) => (
            <div key={k} className="min-w-0 border-b border-r border-line px-4 py-2.5 lg:border-b-0">
              <dt className="text-[12px] text-muted">{k}</dt>
              <dd className="mt-0.5 truncate font-medium text-ink">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="border-t border-line px-4">
          <TabNav
            label="Client sections"
            items={TABS.map((t) => ({
              href: t === "overview" ? base : `${base}?tab=${t}`,
              label: TAB_LABELS[t],
              active: tab === t,
              count: t === "engagements" ? engagements.length : t === "tasks" ? openTasks.length : undefined,
            }))}
          />
        </div>
      </div>

      {tab === "overview" ? (
        <div className="grid gap-5 xl:grid-cols-3">
          <div className="space-y-5 xl:col-span-2">
            <Panel title="Open engagements" flush actions={<ButtonLink href={`${base}?tab=engagements`} variant="ghost" size="sm">View all</ButtonLink>}>
              <EngagementTable
                rows={openEngagements.slice(0, 6)}
                today={today}
                empty={<EmptyState icon={<Briefcase />} title="No open engagements" action={<ButtonLink href={`${base}/engagements/new`} size="sm">New engagement</ButtonLink>} />}
              />
            </Panel>
            <Panel title="Open tasks" flush actions={<ButtonLink href={`${base}?tab=tasks`} variant="ghost" size="sm">View all</ButtonLink>}>
              <TaskTable rows={openTasks.slice(0, 6)} today={today} />
            </Panel>
          </div>
          <div className="space-y-5">
            <Panel title="Contact & classification">
              <DescriptionList
                columns={1}
                items={[
                  ["Client type", CLIENT_TYPE_LABELS[client.type]],
                  ["Status", CLIENT_STATUS_LABELS[client.status]],
                  ["Email", client.email],
                  ["Phone", client.phone],
                  ["Added", formatDate(client.createdAt.toISOString().slice(0, 10))],
                ]}
              />
            </Panel>
            <Panel title="Assigned team">
              {team.length ? (
                <ul className="space-y-2.5">
                  {team.map((m) => (
                    <li key={m.id} className="flex items-center gap-2.5 text-[13px]">
                      <Avatar name={m.name} size="sm" />
                      <span className="text-ink">{m.name}</span>
                      <span className="ml-auto text-[12px] text-muted">{ROLE_LABELS[m.role]}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[13px] text-muted">No one is assigned yet. Owning an engagement assigns a team member.</p>
              )}
            </Panel>
            <Panel title="Portal access">
              {portalUsers.length ? (
                <ul className="mb-4 space-y-2">
                  {portalUsers.map((u) => (
                    <li key={u.id} className="flex items-center justify-between gap-2 text-[13px]">
                      <span className="min-w-0">
                        <span className="block truncate text-ink">{u.name}</span>
                        <span className="block truncate text-[12px] text-muted">{u.email}</span>
                      </span>
                      <Badge tone={!u.isActive ? "neutral" : u.hasPassword ? "good" : "warn"} dot>
                        {!u.isActive ? "Deactivated" : u.hasPassword ? "Active" : "Invited"}
                      </Badge>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mb-4 text-[13px] text-muted">No portal login yet.</p>
              )}
              <PortalInviteForm clientId={client.id} />
            </Panel>
          </div>
        </div>
      ) : null}

      {tab === "engagements" ? (
        <Panel title="Engagements" flush actions={<ButtonLink href={`${base}/engagements/new`} size="sm"><Plus /> New engagement</ButtonLink>}>
          <EngagementTable rows={engagements} today={today} empty={<EmptyState icon={<Briefcase />} title="No engagements yet" />} showService />
        </Panel>
      ) : null}

      {tab === "tasks" ? (
        <Panel title="Open tasks" description="Add or complete tasks from each engagement" flush>
          <TaskTable rows={openTasks} today={today} />
        </Panel>
      ) : null}

      {tab === "documents" ? <DocumentsTab actor={actor} clientId={client.id} engagements={engagements.map((e) => ({ id: e.id, title: e.title }))} /> : null}
      {tab === "messages" ? <MessagesTab actor={actor} clientId={client.id} clientName={client.displayName} /> : null}
      {tab === "billing" ? <BillingTab actor={actor} clientId={client.id} clientEmail={client.email} engagements={engagements} today={today} /> : null}
      {tab === "activity" ? <ActivityTab actor={actor} clientId={client.id} /> : null}
    </div>
  );
}

function EngagementTable({ rows, today, empty, showService }: { rows: Awaited<ReturnType<typeof listClientEngagements>>; today: string; empty: React.ReactNode; showService?: boolean }) {
  if (!rows.length) return <>{empty}</>;
  return (
    <SimpleTable
      label="Engagements"
      headers={[{ label: "Engagement" }, ...(showService ? [{ label: "Service", hideBelow: "md" as const }] : []), { label: "Status" }, { label: "Owner", hideBelow: "sm" }, { label: "Due", align: "right" }]}
    >
      {rows.map((e) => {
        const due = dueLabel(e.dueDate, today);
        const done = e.status === "filed" || e.status === "completed";
        return (
          <tr key={e.id}>
            <td className={td}>
              <Link href={`/staff/engagements/${e.id}`} className="font-medium text-ink hover:text-brand hover:underline">{e.title}</Link>
              <div className="text-[12px] text-muted">
                {e.taxYear ? `Tax year ${e.taxYear} · ` : ""}
                {e.openTaskCount} open task{e.openTaskCount === 1 ? "" : "s"}
              </div>
            </td>
            {showService ? <td className={`${td} ${tdHide.md} text-muted`}>{SERVICE_LABELS[e.serviceType]}</td> : null}
            <td className={td}><Badge tone={ENGAGEMENT_TONE[e.status]} dot>{STATUS_LABELS[e.status]}</Badge></td>
            <td className={`${td} ${tdHide.sm} text-muted`}>{e.ownerName}</td>
            <td className={`${td} text-right`}>
              <div className="tabular whitespace-nowrap text-ink">{formatDate(e.dueDate)}</div>
              {!done && e.dueDate ? <div className={due.tone === "danger" ? "text-[12px] text-danger-ink" : "text-[12px] text-muted"}>{due.text}</div> : null}
            </td>
          </tr>
        );
      })}
    </SimpleTable>
  );
}

function TaskTable({ rows, today }: { rows: Awaited<ReturnType<typeof listTasks>>; today: string }) {
  if (!rows.length) return <EmptyState icon={<CircleCheck />} title="No open tasks" />;
  return (
    <SimpleTable label="Tasks" headers={[{ label: "Task" }, { label: "Assigned to", hideBelow: "sm" }, { label: "Due", align: "right" }]}>
      {rows.map((t) => {
        const due = dueLabel(t.dueDate, today);
        return (
          <tr key={t.id}>
            <td className={td}>
              <Link href={`/staff/engagements/${t.engagementId}`} className="font-medium text-ink hover:text-brand hover:underline">{t.title}</Link>
              <div className="text-[12px] text-muted">{t.engagementTitle}</div>
            </td>
            <td className={`${td} ${tdHide.sm}`}>{t.isClientTask ? <Badge tone="warn">Client</Badge> : <span className="text-muted">{t.assigneeName ?? "Unassigned"}</span>}</td>
            <td className={`${td} text-right`}><Badge tone={due.tone}>{due.text}</Badge></td>
          </tr>
        );
      })}
    </SimpleTable>
  );
}

async function DocumentsTab({ actor, clientId, engagements }: { actor: Actor; clientId: string; engagements: { id: string; title: string }[] }) {
  const docs = await listClientDocuments(getDb(), actor, clientId);
  return (
    <div className="grid gap-5 xl:grid-cols-3">
      <div className="xl:col-span-2">
        <DocumentList docs={docs.map((d) => ({ ...d, createdAt: d.createdAt.toISOString() }))} staff />
      </div>
      <Panel title="Upload a document">
        <UploadForm action={staffUploadAction.bind(null, clientId)} engagements={engagements} staff compact />
      </Panel>
    </div>
  );
}

async function MessagesTab({ actor, clientId, clientName }: { actor: Actor; clientId: string; clientName: string }) {
  const thread = await getThread(getDb(), actor, clientId);
  return (
    <Panel title={`Conversation with ${clientName}`} className="max-w-3xl">
      <MessageThread messages={thread.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() }))} action={staffMessageAction.bind(null, clientId)} emptyText="No messages yet. Your message will appear in the client’s portal." />
    </Panel>
  );
}

async function BillingTab({
  actor,
  clientId,
  clientEmail,
  engagements,
  today,
}: {
  actor: Actor;
  clientId: string;
  clientEmail: string | null;
  engagements: { id: string; title: string; taxYear: number | null }[];
  today: string;
}) {
  const provider = paypalProvider();
  const [rows, subs] = await Promise.all([listClientInvoices(getDb(), actor, clientId, provider), listClientSubscriptions(getDb(), actor, clientId)]);
  return (
    <div className="grid gap-5 xl:grid-cols-5">
      <Panel title="Subscriptions" description="Recurring monthly or yearly billing. The client subscribes from their portal." flush className="xl:col-span-3">
        {subs.length ? (
          <SubscriptionTable rows={subs} showClient={false} canCancel={seesAllClients(actor)} />
        ) : (
          <EmptyState icon={<Repeat />} title="No subscriptions">
            Set up a plan (for example, monthly bookkeeping). The client gets a Subscribe button in their portal and is then charged automatically.
          </EmptyState>
        )}
      </Panel>
      <Panel title="New subscription" className="xl:col-span-2">
        {provider.isConfigured ? (
          <NewSubscriptionForm clientId={clientId} clientEmail={clientEmail} />
        ) : (
          <p className="text-[13px] text-muted">Connect PayPal to set up subscriptions.</p>
        )}
      </Panel>
      <Panel title="Invoices" description="Stored in PayPal; payment status refreshes automatically." flush className="xl:col-span-3">
        {rows.length ? (
          <InvoiceTable rows={rows} showClient={false} canCancel={seesAllClients(actor)} today={today} />
        ) : (
          <EmptyState icon={<Receipt />} title="No invoices yet">
            Invoices you create here are emailed by PayPal. The client can pay by card or PayPal, and also sees them in the portal.
          </EmptyState>
        )}
      </Panel>
      <Panel title="New invoice" className="xl:col-span-2">
        {provider.isConfigured ? (
          <NewInvoiceForm
            clientId={clientId}
            clientEmail={clientEmail}
            engagements={engagements.map((e) => ({ value: e.id, label: e.taxYear ? `${e.title} (${e.taxYear})` : e.title }))}
          />
        ) : (
          <EmptyState icon={<CreditCard />} title="PayPal not connected" action={<ButtonLink href="/staff/integrations" variant="secondary" size="sm">View integrations</ButtonLink>}>
            Add the PayPal app credentials to the server settings to create invoices.
          </EmptyState>
        )}
      </Panel>
    </div>
  );
}

async function ActivityTab({ actor, clientId }: { actor: Actor; clientId: string }) {
  const items = await listClientActivity(getDb(), actor, clientId);
  return (
    <Panel title="Activity history" description="From the audit trail" flush>
      {items.length === 0 ? (
        <EmptyState title="No activity yet" />
      ) : (
        <ol className="divide-y divide-line">
          {items.map((a) => (
            <li key={a.id} className="flex items-start gap-3 px-4 py-2.5 text-[13px]">
              <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-line-strong" />
              <p className="min-w-0 flex-1 text-ink">
                <span className="font-medium">{a.actorName ?? "System"}</span> <span className="text-muted">{ACTIVITY_LABELS[a.action] ?? a.action}</span>
              </p>
              <time className="tabular shrink-0 text-[12px] text-faint" dateTime={a.createdAt.toISOString()}>{timeFmt.format(a.createdAt)}</time>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
