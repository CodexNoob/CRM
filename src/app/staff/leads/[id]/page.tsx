import type { Metadata } from "next";
import { getDb } from "@/db";
import { Alert, Badge, ButtonLink, Card, DescriptionList, PageHeader } from "@/components/ui";
import { requireStaffActor } from "@/lib/auth/current";
import { LEAD_SOURCE_LABELS, LEAD_STATUS_LABELS } from "@/lib/labels";
import { orNotFound } from "@/lib/page-helpers";
import { LEAD_TONE } from "@/lib/status";
import { listStaff } from "@/services/engagements";
import { getLead } from "@/services/leads";
import { ConvertLeadButton, EditLeadForm } from "../lead-forms";

export const metadata: Metadata = { title: "Lead" };

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireStaffActor();
  const { id } = await params;
  const db = getDb();
  const lead = await orNotFound(getLead(db, actor, id));
  const staff = await listStaff(db, actor);
  const converted = lead.status === "converted";

  return (
    <>
      <PageHeader
        title={lead.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={LEAD_TONE[lead.status]} dot>{LEAD_STATUS_LABELS[lead.status]}</Badge>
            <span>{LEAD_SOURCE_LABELS[lead.source]} · received {lead.createdAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
          </span>
        }
      />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {lead.message ? (
            <Card title="Their message">
              <p className="whitespace-pre-wrap wrap-break-word text-sm text-ink">{lead.message}</p>
              {lead.consentAt ? <p className="mt-3 text-xs text-muted">Agreed to be contacted on {lead.consentAt.toLocaleString("en-US")}.</p> : null}
            </Card>
          ) : null}
          <Card title="Details">
            {converted ? (
              <DescriptionList
                items={[
                  ["Email", lead.email],
                  ["Phone", lead.phone],
                  ["Company", lead.company],
                  ["Owner", lead.ownerName],
                  ["Notes", lead.notes],
                ]}
              />
            ) : (
              <EditLeadForm id={lead.id} lead={lead} staff={staff} />
            )}
          </Card>
        </div>
        <Card title={converted ? "Converted" : "Next step"}>
          {converted && lead.convertedClientId ? (
            <div className="space-y-3">
              <Alert tone="success">This lead is now a client.</Alert>
              <ButtonLink href={`/staff/clients/${lead.convertedClientId}`} className="w-full">Open client record</ButtonLink>
            </div>
          ) : (
            <ConvertLeadButton id={lead.id} />
          )}
        </Card>
      </div>
    </>
  );
}
