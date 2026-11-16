import type { Metadata } from "next";
import Link from "next/link";
import { Briefcase, CalendarClock, CircleCheck, CreditCard, Mail, MessageSquare, Pencil, Phone, Plus, Receipt, Repeat } from "lucide-react";
import { getDb } from "@/db";
import { staffMessageAction, staffUploadAction } from "@/app/actions/phase1";
import { DocumentList, UploadForm } from "@/components/documents";
import { ClientConversations } from "@/app/staff/messages/client-conversations";
import { SimpleTable, td, tdHide } from "@/components/table";
import { Alert, Avatar, Badge, ButtonLink, DescriptionList, EmptyState, Panel, StatStrip, TabNav } from "@/components/ui";
import { NewInvoiceForm, NewSubscriptionForm } from "@/components/invoice-client";
import { InvoiceTable } from "@/components/invoice-table";
import { SubscriptionTable } from "@/components/subscription-table";
import { listClientSubscriptions } from "@/services/subscriptions";
import { isManagerOrAdmin, type Actor } from "@/lib/auth/actor";
import { requireStaffActor } from "@/lib/auth/current";
import { FirmScopePicker } from "@/components/staff/firm-scope-picker";
import { can } from "@/lib/auth/permissions";
import {
  CLIENT_STATUS_LABELS,
  CLIENT_TYPE_LABELS,
  formatDate,
  LEAD_STATUS_LABELS,
  ONBOARDING_STATUS_LABELS,
  recordNumber,
  ROLE_LABELS,
  SERVICE_LABELS,
  STATUS_LABELS,
  TASK_STATUS_LABELS,
} from "@/lib/labels";
import { orNotFound } from "@/lib/page-helpers";
import { CLIENT_STATUS_TONE, dueLabel, ENGAGEMENT_DONE, ENGAGEMENT_TONE, ONBOARDING_TONE, TASK_TONE } from "@/lib/status";
import { getClientSummary } from "@/services/client-overview";
import { getClient, listClientContacts, listOnboardingItems } from "@/services/clients";
import { firmToday } from "@/services/dashboard";
import { listClientDocuments } from "@/services/documents";
import { listClientEngagements, listStaff } from "@/services/engagements";
import { listClientInvoices, paypalProvider } from "@/services/invoices";
import { ACTIVITY_LABELS, getClientTeam, listClientActivity } from "@/services/insights";
import { listClientConversations } from "@/services/messages";
import { listTasks } from "@/services/tasks";
import { listClientTimeline, listStatusHistory } from "@/services/timeline";
import { listPortalUsers } from "@/services/users";
import { listPlatformFirms, resolveFirmContext } from "@/services/firms";
import { ArchiveClientButton, ContactsPanel, OnboardingChecklist } from "./client-controls";
import { ClientTimeline } from "./client-timeline";
import { PortalInviteForm } from "./portal-invite-form";

export const metadata: Metadata = { title: "Client" };

const TABS = ["overview", "contacts", "engagements", "tasks", "documents", "messages", "activity", "billing"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABELS: Record<Tab, string> = {
  overview: "Overview",
  contacts: "Contacts",
  engagements: "Engagements",
  tasks: "Tasks",
  documents: "Documents",
  messages: "Messages",
  activity: "Activities",
  billing: "Billing",
};
const timeFmt = new Intl.DateTimeFormat("en-US", { timeZone: process.env.FIRM_TIMEZONE || "America/New_York", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

export default async function ClientPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; converted?: string; firmId?: string }> }) {
  const signedInActor = await requireStaffActor();
  const { id } = await params;
  const sp = await searchParams;
  const db = getDb();
  const actor = await resolveFirmContext(db, signedInActor, sp.firmId);
  const firms = signedInActor.role === "super_admin" ? await listPlatformFirms(db, signedInActor) : [];
  const canBilling = can(actor, "billing", "view");
  const tabs = TABS.filter((t) => t !== "billing" || canBilling);
  const tab: Tab = (tabs as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as Tab) : "overview";
  const client = await orNotFound(getClient(db, actor, id));
  const today = firmToday();
  const [engagements, team, portalUsers, openTasks, summary, contacts, staff] = await Promise.all([
    listClientEngagements(db, actor, id),
    getClientTeam(db, actor, id),
    listPortalUsers(db, actor, id),
    listTasks(db, actor, { clientId: id }),
    getClientSummary(db, actor, id, today),
    listClientContacts(db, actor, id),
    listStaff(db, actor),
  ]);
  const openEngagements = engagements.filter((e) => !ENGAGEMENT_DONE.includes(e.status));
  const base = `/staff/clients/${client.id}`;
  const firmQuery = signedInActor.role === "super_admin" ? `&firmId=${encodeURIComponent(actor.firmId)}` : "";
  const portalActive = portalUsers.some((u) => u.isActive && u.hasPassword);
  const staffNames = Object.fromEntries(staff.map((s) => [s.id, s.name]));
  const canEdit = can(actor, "clients", "edit");
  const canCreateEngagement = can(actor, "engagements", "create");
  const archived = !!client.archivedAt;

  const headerFacts: [string, React.ReactNode][] = [
    ["Client no.", recordNumber("C", client.clientNumber) ?? "—"],
    ["Account manager", summary.accountManagerName ?? "—"],
    ["Onboarding", <Badge key="o" tone={ONBOARDING_TONE[client.onboardingStatus]} dot>{ONBOARDING_STATUS_LABELS[client.onboardingStatus]}</Badge>],
    ["Active engagements", summary.activeEngagements],
    ["Portal access", portalActive ? <Badge key="p" tone="good">Active</Badge> : portalUsers.length ? <Badge key="p" tone="warn">Invited</Badge> : "None"],
  ];

  return (
    <div className="space-y-5">
      {sp.converted === "1" ? (
        <Alert tone="success" title="Lead converted">
          <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span>{client.displayName} is now a client. Next: create an engagement for the work you agreed on.</span>
            {canCreateEngagement ? (
              <ButtonLink href={`${base}/engagements/new`} size="sm">
                <Plus /> New engagement
              </ButtonLink>
            ) : null}
          </span>
        </Alert>
      ) : null}
      {archived ? <Alert tone="warning">This client is archived. It is hidden from the client list; all history is kept.</Alert> : null}
      {tab === "billing" && signedInActor.role === "super_admin" ? <FirmScopePicker action="/staff/invoices" currentFirmId={actor.firmId} firms={firms} /> : null}

      <div className="rounded-lg border border-line bg-surface">
        <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <Avatar name={client.displayName} size="lg" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-[18px] font-semibold leading-7 text-ink">{client.displayName}</h1>
                <Badge tone={archived ? "neutral" : CLIENT_STATUS_TONE[client.status]} dot>
                  {archived ? "Archived" : CLIENT_STATUS_LABELS[client.status]}
                </Badge>
                <Badge>{CLIENT_TYPE_LABELS[client.type]}</Badge>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted">
                {client.clientNumber ? <span className="tabular">{recordNumber("C", client.clientNumber)}</span> : null}
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
            {can(actor, "clients", "delete") ? <ArchiveClientButton clientId={client.id} clientName={client.displayName} archived={archived} /> : null}
            {canEdit ? (
              <ButtonLink href={`${base}/edit`} variant="secondary">
                <Pencil /> Edit
              </ButtonLink>
            ) : null}
            {canCreateEngagement && !archived ? (
              <ButtonLink href={`${base}/engagements/new`}>
                <Plus /> New engagement
              </ButtonLink>
            ) : null}
          </div>
        </div>
        <dl className="grid grid-cols-2 border-t border-line text-[13px] sm:grid-cols-3 lg:grid-cols-5">
          {headerFacts.map(([k, v]) => (
            <div key={k} className="min-w-0 border-b border-r border-line px-4 py-2.5 lg:border-b-0">
              <dt className="text-[12px] text-muted">{k}</dt>
              <dd className="mt-0.5 truncate font-medium text-ink">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="border-t border-line px-4">
          <TabNav
            label="Client sections"
            items={tabs.map((t) => ({
              href: t === "overview" ? `${base}${signedInActor.role === "super_admin" ? `?firmId=${encodeURIComponent(actor.firmId)}` : ""}` : `${base}?tab=${t}${firmQuery}`,
              label: TAB_LABELS[t],
              active: tab === t,
              count: t === "engagements" ? engagements.length : t === "tasks" ? openTasks.length : t === "contacts" ? contacts.length || undefined : undefined,
            }))}
          />
        </div>
      </div>

      {tab === "overview" ? (
        <OverviewTab
          actor={actor}
          clientId={client.id}
          base={base}
          today={today}
          summary={summary}
          openEngagements={openEngagements}
          team={team}
          portalUsers={portalUsers}
          staffNames={staffNames}
          canEdit={canEdit}
          canCreateEngagement={canCreateEngagement && !archived}
          info={[
            ["Client type", CLIENT_TYPE_LABELS[client.type]],
            ["Status", CLIENT_STATUS_LABELS[client.status]],
            ["Account manager", summary.accountManagerName ?? "None"],
            ["Onboarding", ONBOARDING_STATUS_LABELS[client.onboardingStatus]],
            ...(client.type !== "business" && (client.firstName || client.lastName) ? [["Name", [client.firstName, client.lastName].filter(Boolean).join(" ")] as [string, string]] : []),
            ["Email", client.email],
            ["Phone", client.phone],
            ["Address", client.address],
            ["Added", formatDate(client.createdAt.toISOString().slice(0, 10))],
          ]}
          sourceLeadId={client.sourceLeadId}
          notes={client.notes}
          onboardingStatus={client.onboardingStatus}
        />
      ) : null}

      {tab === "contacts" ? (
        <ContactsPanel
          clientId={client.id}
          isBusiness={client.type === "business"}
          canEdit={canEdit}
          contacts={contacts.map((c) => ({ id: c.id, name: c.name, title: c.title, role: c.role, email: c.email, phone: c.phone, isPrimary: c.isPrimary, notes: c.notes }))}
        />
      ) : null}

      {tab === "engagements" ? (
        <Panel
          title="Engagements"
          flush
          actions={
            canCreateEngagement && !archived ? (
              <ButtonLink href={`${base}/engagements/new`} size="sm">
                <Plus /> New engagement
              </ButtonLink>
            ) : undefined
          }
        >
          <EngagementTable rows={engagements} today={today} empty={<EmptyState icon={<Briefcase />} title="No engagements yet" />} showService />
        </Panel>
      ) : null}

      {tab === "tasks" ? (
        <Panel title="Pending tasks" description="Tasks on this client’s engagements that still need doing" flush>
          <TaskTable rows={openTasks} today={today} />
        </Panel>
      ) : null}

      {tab === "documents" ? <DocumentsTab actor={actor} clientId={client.id} engagements={engagements.map((e) => ({ id: e.id, title: e.title }))} /> : null}
      {tab === "messages" ? <MessagesTab actor={actor} clientId={client.id} clientName={client.displayName} /> : null}
      {tab === "billing" && canBilling ? <BillingTab actor={actor} clientId={client.id} clientEmail={client.email} engagements={engagements} today={today} firmId={actor.firmId} /> : null}
      {tab === "activity" ? <ActivityTab actor={actor} clientId={client.id} staffNames={staffNames} /> : null}
    </div>
  );
}

async function OverviewTab({
  actor,
  clientId,
  base,
  today,
  summary,
  openEngagements,
  team,
  portalUsers,
  staffNames,
  canEdit,
  canCreateEngagement,
  info,
  sourceLeadId,
  notes,
  onboardingStatus,
}: {
  actor: Actor;
  clientId: string;
  base: string;
  today: string;
  summary: Awaited<ReturnType<typeof getClientSummary>>;
  openEngagements: Awaited<ReturnType<typeof listClientEngagements>>;
  team: Awaited<ReturnType<typeof getClientTeam>>;
  portalUsers: Awaited<ReturnType<typeof listPortalUsers>>;
  staffNames: Record<string, string>;
  canEdit: boolean;
  canCreateEngagement: boolean;
  info: [string, React.ReactNode][];
  sourceLeadId: string | null;
  notes: string | null;
  onboardingStatus: keyof typeof ONBOARDING_STATUS_LABELS;
}) {
  const db = getDb();
  const [items, recent] = await Promise.all([listOnboardingItems(db, actor, clientId), listClientTimeline(db, actor, clientId, 5)]);

  return (
    <div className="space-y-5">
      <StatStrip
        items={[
          { label: "Active engagements", value: summary.activeEngagements, href: `${base}?tab=engagements` },
          { label: "Pending tasks", value: summary.pendingTasks, href: `${base}?tab=tasks` },
          { label: "Overdue tasks", value: summary.overdueTasks, tone: summary.overdueTasks ? "danger" : "default", href: `${base}?tab=tasks` },
          {
            label: "Onboarding",
            value: summary.onboarding.total ? `${summary.onboarding.done}/${summary.onboarding.total}` : "—",
            hint: ONBOARDING_STATUS_LABELS[onboardingStatus],
            href: "#onboarding",
            tone: onboardingStatus === "completed" ? "success" : "default",
          },
        ]}
      />
      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <OnboardingChecklist
            clientId={clientId}
            status={onboardingStatus}
            canEdit={canEdit}
            canApprove={can(actor, "clients", "approve")}
            items={items.map((i) => ({ id: i.id, title: i.title, kind: i.kind, status: i.status, receivedAt: i.receivedAt?.toISOString() ?? null, verifiedAt: i.verifiedAt?.toISOString() ?? null }))}
          />
          <Panel title="Upcoming deadlines" description="Engagements and tasks due in the next 30 days" flush>
            {summary.upcoming.length ? (
              <ul className="divide-y divide-line">
                {summary.upcoming.map((u) => {
                  const d = dueLabel(u.dueDate, today);
                  return (
                    <li key={`${u.kind}-${u.id}`} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
                      <Badge tone={u.kind === "engagement" ? "brand" : "neutral"}>{u.kind === "engagement" ? "Engagement" : "Task"}</Badge>
                      <Link href={u.href} className="min-w-0 flex-1 truncate font-medium text-ink hover:text-brand hover:underline">
                        {u.title}
                      </Link>
                      <span className="tabular text-muted">{formatDate(u.dueDate)}</span>
                      <Badge tone={d.tone}>{d.text}</Badge>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState icon={<CalendarClock />} title="Nothing due in the next 30 days" />
            )}
          </Panel>
          <Panel
            title="Open engagements"
            flush
            actions={
              <ButtonLink href={`${base}?tab=engagements`} variant="ghost" size="sm">
                View all
              </ButtonLink>
            }
          >
            <EngagementTable
              rows={openEngagements.slice(0, 6)}
              today={today}
              empty={
                <EmptyState
                  icon={<Briefcase />}
                  title="No open engagements"
                  action={
                    canCreateEngagement ? (
                      <ButtonLink href={`${base}/engagements/new`} size="sm">
                        New engagement
                      </ButtonLink>
                    ) : undefined
                  }
                />
              }
            />
          </Panel>
          <Panel
            title="Recent activity"
            flush
            actions={
              <ButtonLink href={`${base}?tab=activity`} variant="ghost" size="sm">
                View all
              </ButtonLink>
            }
          >
            <ClientTimeline items={recent} staffNames={staffNames} />
          </Panel>
        </div>
        <div className="space-y-5">
          <Panel title="Client information">
            <DescriptionList columns={1} items={info} />
            {sourceLeadId ? (
              <p className="mt-3 text-[12.5px] text-muted">
                Converted from a{" "}
                <Link href={`/staff/leads/${sourceLeadId}`} className="text-brand-ink hover:underline">
                  lead
                </Link>
                .
              </p>
            ) : null}
            {notes ? <p className="mt-3 whitespace-pre-line border-t border-line pt-3 text-[13px] text-ink">{notes}</p> : null}
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
            {canEdit ? <PortalInviteForm clientId={clientId} /> : null}
          </Panel>
        </div>
      </div>
    </div>
  );
}

function EngagementTable({ rows, today, empty, showService }: { rows: Awaited<ReturnType<typeof listClientEngagements>>; today: string; empty: React.ReactNode; showService?: boolean }) {
  if (!rows.length) return <>{empty}</>;
  return (
    <SimpleTable
      label="Engagements"
      headers={[{ label: "Engagement" }, ...(showService ? [{ label: "Service", hideBelow: "md" as const }] : []), { label: "Status" }, { label: "Manager", hideBelow: "sm" }, { label: "Due", align: "right" }]}
    >
      {rows.map((e) => {
        const due = dueLabel(e.dueDate, today);
        const done = ENGAGEMENT_DONE.includes(e.status);
        return (
          <tr key={e.id}>
            <td className={td}>
              <Link href={`/staff/engagements/${e.id}`} className="font-medium text-ink hover:text-brand hover:underline">
                {e.title}
              </Link>
              <div className="text-[12px] text-muted">
                {e.taxYear ? `Tax year ${e.taxYear} · ` : ""}
                {e.openTaskCount} open task{e.openTaskCount === 1 ? "" : "s"}
              </div>
            </td>
            {showService ? <td className={`${td} ${tdHide.md} text-muted`}>{SERVICE_LABELS[e.serviceType]}</td> : null}
            <td className={td}>
              <Badge tone={ENGAGEMENT_TONE[e.status]} dot>
                {STATUS_LABELS[e.status]}
              </Badge>
            </td>
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
  if (!rows.length) return <EmptyState icon={<CircleCheck />} title="No pending tasks" />;
  return (
    <SimpleTable label="Tasks" headers={[{ label: "Task" }, { label: "Status", hideBelow: "sm" }, { label: "Assigned to", hideBelow: "md" }, { label: "Due", align: "right" }]}>
      {rows.map((t) => {
        const due = dueLabel(t.dueDate, today);
        return (
          <tr key={t.id}>
            <td className={td}>
              <Link href={`/staff/engagements/${t.engagementId}`} className="font-medium text-ink hover:text-brand hover:underline">
                {t.title}
              </Link>
              <div className="text-[12px] text-muted">{t.engagementTitle}</div>
            </td>
            <td className={`${td} ${tdHide.sm}`}>
              <Badge tone={TASK_TONE[t.status]} dot>
                {TASK_STATUS_LABELS[t.status]}
              </Badge>
            </td>
            <td className={`${td} ${tdHide.md}`}>{t.isClientTask ? <Badge tone="warn">Client</Badge> : <span className="text-muted">{t.assigneeName ?? "Unassigned"}</span>}</td>
            <td className={`${td} text-right`}>{t.dueDate ? <Badge tone={due.tone}>{due.text}</Badge> : <span className="text-faint">—</span>}</td>
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
      {can(actor, "clients", "edit") ? (
        <Panel title="Upload a document">
          <UploadForm action={staffUploadAction.bind(null, clientId)} engagements={engagements} staff compact />
        </Panel>
      ) : null}
    </div>
  );
}

async function MessagesTab({ actor, clientId, clientName }: { actor: Actor; clientId: string; clientName: string }) {
  const db = getDb();
  const [convos, staff] = await Promise.all([listClientConversations(db, actor, clientId), listStaff(db, actor)]);
  return (
    <ClientConversations
      clientId={clientId}
      clientName={clientName}
      convos={convos}
      staff={staff.map((s) => ({ id: s.id, name: s.name }))}
      canCreate={can(actor, "messages", "create")}
      canAssign={can(actor, "messages", "assign")}
      quickAction={can(actor, "messages", "reply") ? staffMessageAction.bind(null, clientId) : null}
    />
  );
}

async function BillingTab({
  actor,
  clientId,
  clientEmail,
  engagements,
  today,
  firmId,
}: {
  actor: Actor;
  clientId: string;
  clientEmail: string | null;
  engagements: { id: string; title: string; taxYear: number | null }[];
  today: string;
  firmId: string;
}) {
  const provider = paypalProvider();
  const canCreate = can(actor, "billing", "create");
  const [rows, subs] = await Promise.all([listClientInvoices(getDb(), actor, clientId, provider), listClientSubscriptions(getDb(), actor, clientId)]);
  return (
    <div className="grid gap-5 xl:grid-cols-5">
      <Panel title="Subscriptions" description="Recurring monthly or yearly billing. The client subscribes from their portal." flush className="xl:col-span-3">
        {subs.length ? (
          <SubscriptionTable rows={subs} showClient={false} canCancel={isManagerOrAdmin(actor)} firmId={firmId} />
        ) : (
          <EmptyState icon={<Repeat />} title="No subscriptions">
            Set up a plan (for example, monthly bookkeeping). The client gets a Subscribe button in their portal and is then charged automatically.
          </EmptyState>
        )}
      </Panel>
      {canCreate ? (
        <Panel title="New subscription" className="xl:col-span-2">
          {provider.isConfigured ? <NewSubscriptionForm clientId={clientId} clientEmail={clientEmail} firmId={firmId} /> : <p className="text-[13px] text-muted">Connect PayPal to set up subscriptions.</p>}
        </Panel>
      ) : null}
      <Panel title="Invoices" description="Stored in PayPal; payment status refreshes automatically." flush className="xl:col-span-3">
        {rows.length ? (
          <InvoiceTable rows={rows} showClient={false} canCancel={isManagerOrAdmin(actor)} today={today} firmId={firmId} />
        ) : (
          <EmptyState icon={<Receipt />} title="No invoices yet">
            Invoices you create here are emailed by PayPal. The client can pay by card or PayPal, and also sees them in the portal.
          </EmptyState>
        )}
      </Panel>
      {canCreate ? (
        <Panel title="New invoice" className="xl:col-span-2">
          {provider.isConfigured ? (
            <NewInvoiceForm clientId={clientId} clientEmail={clientEmail} engagements={engagements.map((e) => ({ value: e.id, label: e.taxYear ? `${e.title} (${e.taxYear})` : e.title }))} firmId={firmId} />
          ) : (
            <EmptyState
              icon={<CreditCard />}
              title="PayPal not connected"
              action={
                <ButtonLink href="/staff/integrations" variant="secondary" size="sm">
                  View integrations
                </ButtonLink>
              }
            >
              Add the PayPal app credentials to the server settings to create invoices.
            </EmptyState>
          )}
        </Panel>
      ) : null}
    </div>
  );
}

async function ActivityTab({ actor, clientId, staffNames }: { actor: Actor; clientId: string; staffNames: Record<string, string> }) {
  const db = getDb();
  const [timeline, history, audit] = await Promise.all([listClientTimeline(db, actor, clientId, 200), listStatusHistory(db, actor, "client", clientId), listClientActivity(db, actor, clientId)]);
  return (
    <div className="grid gap-5 xl:grid-cols-3">
      <Panel title="Activity timeline" description="Notes, assignments and status changes on this client, its lead, engagements and tasks" flush className="xl:col-span-2">
        <ClientTimeline items={timeline} staffNames={staffNames} />
      </Panel>
      <div className="space-y-5">
        <Panel title="Status history" flush>
          {history.length ? (
            <ol className="divide-y divide-line">
              {history.map((h) => (
                <li key={h.id} className="px-4 py-2.5 text-[13px]">
                  <p className="text-ink">
                    {h.oldStatus ? <span className="text-muted">{CLIENT_STATUS_LABELS[h.oldStatus as keyof typeof CLIENT_STATUS_LABELS] ?? h.oldStatus} → </span> : null}
                    <span className="font-medium">{CLIENT_STATUS_LABELS[h.newStatus as keyof typeof CLIENT_STATUS_LABELS] ?? LEAD_STATUS_LABELS[h.newStatus as keyof typeof LEAD_STATUS_LABELS] ?? h.newStatus}</span>
                  </p>
                  <p className="text-[12px] text-faint">
                    {h.changedByName ?? "System"} · {timeFmt.format(h.createdAt)}
                    {h.note ? ` · ${h.note}` : ""}
                  </p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="px-4 py-3 text-[13px] text-muted">No status changes yet.</p>
          )}
        </Panel>
        <Panel title="Audit trail" description="Security log of record changes" flush>
          {audit.length === 0 ? (
            <p className="px-4 py-3 text-[13px] text-muted">No audit entries yet.</p>
          ) : (
            <ol className="max-h-96 divide-y divide-line overflow-y-auto">
              {audit.map((a) => (
                <li key={a.id} className="flex items-start gap-3 px-4 py-2 text-[12.5px]">
                  <p className="min-w-0 flex-1 text-ink">
                    <span className="font-medium">{a.actorName ?? "System"}</span> <span className="text-muted">{ACTIVITY_LABELS[a.action] ?? a.action}</span>
                  </p>
                  <time className="tabular shrink-0 text-[11.5px] text-faint" dateTime={a.createdAt.toISOString()}>
                    {timeFmt.format(a.createdAt)}
                  </time>
                </li>
              ))}
            </ol>
          )}
        </Panel>
      </div>
    </div>
  );
}
