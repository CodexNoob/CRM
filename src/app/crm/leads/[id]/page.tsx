import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Info, Mail, MessageSquare, Phone, StickyNote, UserPlus, Users } from "lucide-react";
import type { ReactNode } from "react";
import { getDb } from "@/db";
import type { LeadStatus } from "@/db/schema";
import { SimpleTable, td } from "@/components/table";
import { Alert, Badge, ButtonLink, DescriptionList, EmptyState, Panel } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { requireStaffActor } from "@/lib/auth/current";
import { ACTIVITY_TYPE_LABELS, CLIENT_TYPE_LABELS, formatDate, formatMoney, LEAD_SOURCE_LABELS, LEAD_STATUS_LABELS, PRIORITY_LABELS, recordNumber, SERVICE_LABELS } from "@/lib/labels";
import { orNotFound } from "@/lib/page-helpers";
import { LEAD_TONE, PRIORITY_TONE } from "@/lib/status";
import { listClientOptions } from "@/services/clients";
import { firmToday } from "@/services/dashboard";
import { listStaff } from "@/services/engagements";
import { findLeadDuplicates, getLead } from "@/services/leads";
import { listEntityTimeline, listStatusHistory, type TimelineItem } from "@/services/timeline";
import { ArchiveLeadButton, ConvertLeadButton, EditLeadButton, LogActivityForm, StageControl, type LeadView } from "../lead-forms";

export const metadata: Metadata = { title: "Lead" };

const FIRM_TZ = process.env.FIRM_TIMEZONE || "America/New_York";
const when = new Intl.DateTimeFormat("en-US", { timeZone: FIRM_TZ, month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

const ICONS: Record<TimelineItem["type"], ReactNode> = {
  note: <StickyNote />,
  call: <Phone />,
  email: <Mail />,
  meeting: <Users />,
  comment: <MessageSquare />,
  internal_note: <StickyNote />,
  assignment: <UserPlus />,
  status_change: <ArrowRight />,
  system: <Info />,
};

const stageLabel = (s: unknown) => (typeof s === "string" && s in LEAD_STATUS_LABELS ? LEAD_STATUS_LABELS[s as LeadStatus] : typeof s === "string" ? s : "—");

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireStaffActor();
  const { id } = await params;
  const db = getDb();
  const lead = await orNotFound(getLead(db, actor, id));
  const converted = lead.status === "converted";
  const canEdit = can(actor, "leads", "edit") && !converted;
  const canConvert = !converted && can(actor, "leads", "edit") && can(actor, "clients", "create");
  const [staff, timeline, history, duplicates, clients] = await Promise.all([
    listStaff(db, actor),
    listEntityTimeline(db, actor, "lead", lead.id),
    listStatusHistory(db, actor, "lead", lead.id),
    canConvert ? findLeadDuplicates(db, actor, lead.id) : Promise.resolve([]),
    canConvert ? listClientOptions(db, actor) : Promise.resolve([]),
  ]);
  const staffName = new Map(staff.map((s) => [s.id, s.name]));
  const today = firmToday();
  const followOverdue = !!lead.followUpDate && lead.followUpDate < today && !converted && lead.status !== "lost";
  const number = recordNumber("L", lead.leadNumber);
  const staffOptions = staff.map((s) => ({ id: s.id, name: s.name }));
  const canAssign = can(actor, "leads", "assign");
  const view: LeadView = {
    id: lead.id,
    name: lead.name,
    company: lead.company,
    email: lead.email,
    phone: lead.phone,
    clientType: lead.clientType,
    address: lead.address,
    requestedServices: lead.requestedServices ?? [],
    source: lead.source,
    priority: lead.priority,
    estimatedValueCents: lead.estimatedValueCents,
    ownerId: lead.ownerId,
    followUpDate: lead.followUpDate,
    message: lead.message,
    notes: lead.notes,
    status: lead.status,
  };

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-line bg-surface p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-[12px] text-muted">
              <Link href="/crm/leads" className="hover:text-ink hover:underline">
                Leads & Prospects
              </Link>
              {number ? ` · ${number}` : ""}
            </p>
            <h1 className="mt-0.5 text-[18px] font-semibold leading-7 text-ink">
              {lead.name}
              {lead.company ? <span className="font-normal text-muted"> · {lead.company}</span> : null}
            </h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[13px] text-muted">
              <Badge tone={LEAD_TONE[lead.status]} dot>
                {LEAD_STATUS_LABELS[lead.status]}
              </Badge>
              {lead.priority !== "normal" ? <Badge tone={PRIORITY_TONE[lead.priority]}>{PRIORITY_LABELS[lead.priority]} priority</Badge> : null}
              <span>Assigned to {lead.ownerName ?? "no one"}</span>
              <span>· {LEAD_SOURCE_LABELS[lead.source]}</span>
              <span>· created {formatDate(lead.createdAt.toISOString().slice(0, 10))}</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {canConvert ? (
              <ConvertLeadButton
                lead={view}
                staff={staffOptions}
                canAssign={can(actor, "clients", "assign")}
                clients={clients.map((c) => ({ id: c.id, name: c.clientNumber ? `${c.name} (C-${String(c.clientNumber).padStart(4, "0")})` : c.name }))}
                duplicates={duplicates.map((d) => ({ id: d.id, displayName: d.displayName, email: d.email, phone: d.phone, number: recordNumber("C", d.clientNumber), reasons: d.reasons }))}
              />
            ) : null}
            {converted && lead.convertedClientId ? <ButtonLink href={`/crm/clients/${lead.convertedClientId}`}>Open client</ButtonLink> : null}
            {canEdit ? <EditLeadButton lead={view} staff={staffOptions} canAssign={canAssign} meId={actor.userId} /> : null}
            {can(actor, "leads", "delete") && !converted ? <ArchiveLeadButton id={lead.id} archived={!!lead.archivedAt} /> : null}
          </div>
        </div>
        {lead.archivedAt ? (
          <div className="mt-3">
            <Alert tone="warning">This lead is archived and hidden from lists.</Alert>
          </div>
        ) : null}
      </div>

      <div className="grid gap-5 xl:grid-cols-[1fr_22rem]">
        <div className="space-y-5">
          {converted ? (
            <Panel title="Conversion">
              <Alert tone="success" title="Won / Converted">
                {lead.convertedClientName ? (
                  <>
                    Linked to client{" "}
                    <Link href={`/crm/clients/${lead.convertedClientId}`} className="font-medium underline underline-offset-2">
                      {lead.convertedClientName}
                    </Link>
                  </>
                ) : (
                  "Converted to a client."
                )}
                {lead.convertedAt ? ` on ${when.format(lead.convertedAt)}` : ""}
                {lead.convertedById ? ` by ${lead.convertedByName ?? staffName.get(lead.convertedById) ?? "a staff member"}` : ""}.
              </Alert>
              <p className="mt-3 text-[13px] text-muted">This lead record and its history are kept. Ongoing work lives on the client.</p>
              {lead.convertedClientId ? (
                <div className="mt-3">
                  <ButtonLink href={`/crm/clients/${lead.convertedClientId}/engagements/new`} variant="secondary">
                    Create an engagement for this client
                  </ButtonLink>
                </div>
              ) : null}
            </Panel>
          ) : null}

          <Panel title="Lead information">
            <DescriptionList
              items={[
                ["Email", lead.email ? <a href={`mailto:${lead.email}`} className="hover:underline">{lead.email}</a> : null],
                ["Phone", lead.phone ? <a href={`tel:${lead.phone.replace(/[^0-9+]/g, "")}`} className="hover:underline">{lead.phone}</a> : null],
                ["Company", lead.company],
                ["Client type", lead.clientType ? CLIENT_TYPE_LABELS[lead.clientType] : null],
                ["Address", lead.address],
                ["Source", LEAD_SOURCE_LABELS[lead.source]],
                ["Requested services", lead.requestedServices?.length ? lead.requestedServices.map((s) => SERVICE_LABELS[s]).join(", ") : null],
                ["Estimated value", lead.estimatedValueCents !== null ? formatMoney(lead.estimatedValueCents) : null],
                ["Lost reason", lead.status === "lost" ? lead.lostReason : null],
              ].filter(([, v]) => v !== null && v !== undefined && v !== "") as [string, ReactNode][]}
            />
            {lead.notes ? (
              <div className="mt-4 border-t border-line pt-3">
                <p className="text-[12px] text-muted">Internal notes</p>
                <p className="mt-1 whitespace-pre-wrap text-[13px] text-ink">{lead.notes}</p>
              </div>
            ) : null}
          </Panel>

          {lead.message ? (
            <Panel title="Their message" description="Written by the prospect — treat as unverified.">
              <p className="whitespace-pre-wrap wrap-break-word text-[13px] text-ink">{lead.message}</p>
              {lead.consentAt ? <p className="mt-3 text-[12px] text-muted">Agreed to be contacted on {when.format(lead.consentAt)}.</p> : null}
            </Panel>
          ) : null}

          {canEdit ? (
            <Panel title="Log activity" description="Record a note, call, email or meeting.">
              <LogActivityForm id={lead.id} />
            </Panel>
          ) : null}

          <Panel title="Activity timeline" flush>
            {timeline.length ? (
              <ol className="divide-y divide-line">
                {timeline.map((a) => (
                  <li key={a.id} className="flex gap-3 px-4 py-3">
                    <span aria-hidden className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border border-line bg-subtle text-muted [&_svg]:size-3.5">
                      {ICONS[a.type]}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] text-ink">
                        <span className="font-medium">{ACTIVITY_TYPE_LABELS[a.type]}</span>
                        {a.type === "status_change" ? (
                          <span className="text-muted">
                            {" "}
                            · {a.metadata?.from ? `${stageLabel(a.metadata.from)} → ` : ""}
                            {stageLabel(a.metadata?.to)}
                          </span>
                        ) : a.type === "assignment" ? (
                          <span className="text-muted"> · assigned to {typeof a.metadata?.userId === "string" ? (staffName.get(a.metadata.userId) ?? "a staff member") : "no one"}</span>
                        ) : null}
                      </p>
                      {a.body ? <p className="mt-0.5 whitespace-pre-wrap wrap-break-word text-[13px] text-ink">{a.body}</p> : null}
                      <p className="mt-0.5 text-[12px] text-muted">
                        {a.actorName ?? "System"} · <time dateTime={a.occurredAt.toISOString()}>{when.format(a.occurredAt)}</time>
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyState title="No activity yet">Log a call, email, meeting or note to start the timeline.</EmptyState>
            )}
          </Panel>
        </div>

        <div className="space-y-5">
          {canEdit ? (
            <Panel title="Pipeline stage">
              <StageControl key={lead.status} id={lead.id} status={lead.status} />
            </Panel>
          ) : null}

          <Panel title="Follow-up">
            <DescriptionList
              columns={1}
              items={[
                [
                  "Next follow-up",
                  lead.followUpDate ? (
                    <span className={followOverdue ? "font-medium text-danger-ink" : undefined}>
                      {formatDate(lead.followUpDate)}
                      {followOverdue ? " (overdue)" : ""}
                    </span>
                  ) : (
                    "Not scheduled"
                  ),
                ],
                ["Last contacted", lead.lastContactedAt ? when.format(lead.lastContactedAt) : "Not yet"],
                ["Assigned to", lead.ownerName ?? "Unassigned"],
              ]}
            />
            {canEdit ? <p className="mt-3 text-[12px] text-muted">Schedule the next follow-up when you log an activity, or in Edit.</p> : null}
          </Panel>

          <Panel title="Stage history" flush>
            {history.length ? (
              <SimpleTable label="Stage history" headers={[{ label: "Stage" }, { label: "By" }, { label: "When", align: "right" }]}>
                {history.map((h) => (
                  <tr key={h.id}>
                    <td className={td}>
                      <span className="text-ink">{stageLabel(h.newStatus)}</span>
                      {h.oldStatus ? <span className="block text-[12px] text-muted">from {stageLabel(h.oldStatus)}</span> : null}
                      {h.note ? <span className="block text-[12px] text-muted">{h.note}</span> : null}
                    </td>
                    <td className={`${td} text-muted`}>{h.changedByName ?? "System"}</td>
                    <td className={`${td} whitespace-nowrap text-right text-[12px] text-muted`}>{when.format(h.createdAt)}</td>
                  </tr>
                ))}
              </SimpleTable>
            ) : (
              <EmptyState title="No stage changes yet" />
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
