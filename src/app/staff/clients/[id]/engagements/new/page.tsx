import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { createEngagementAction } from "@/app/actions/engagements";
import { Card, PageHeader } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { requireStaffActor } from "@/lib/auth/current";
import { orNotFound } from "@/lib/page-helpers";
import { getClient } from "@/services/clients";
import { listStaff } from "@/services/engagements";
import { EngagementForm } from "../../../../engagement-form";

export const metadata: Metadata = { title: "New engagement" };

export default async function NewEngagementPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireStaffActor();
  if (!can(actor, "engagements", "create")) notFound();
  const { id } = await params;
  const db = getDb();
  const client = await orNotFound(getClient(db, actor, id));
  const staff = await listStaff(db, actor);
  return (
    <>
      <PageHeader title="New engagement" description={`For ${client.displayName}. After saving you can generate the tasks from a workflow template.`} />
      <Card className="max-w-3xl">
        <EngagementForm
          action={createEngagementAction.bind(null, client.id)}
          staff={staff}
          initial={{ ownerId: actor.userId, taxYear: new Date().getFullYear(), proposalStatus: "not_required" }}
          cancelHref={`/staff/clients/${client.id}`}
          submitLabel="Create engagement"
          canAssign={can(actor, "engagements", "assign")}
          actorId={actor.userId}
        />
      </Card>
    </>
  );
}
