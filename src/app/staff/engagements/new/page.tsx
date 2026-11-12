import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { createEngagementWithClientAction } from "@/app/actions/engagements";
import { Card, PageHeader } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { requireStaffActor } from "@/lib/auth/current";
import { listClients } from "@/services/clients";
import { listStaff } from "@/services/engagements";
import { EngagementForm } from "../../engagement-form";

export const metadata: Metadata = { title: "New engagement" };

/** "New engagement" from the engagements list: pick the client in the form. */
export default async function NewEngagementFromListPage() {
  const actor = await requireStaffActor();
  if (!can(actor, "engagements", "create")) notFound();
  const db = getDb();
  const [clients, staff] = await Promise.all([listClients(db, actor), listStaff(db, actor)]);
  return (
    <>
      <PageHeader title="New engagement" description="Choose the client, the service and the team. After saving you can generate tasks from a workflow template." />
      <Card className="max-w-3xl">
        <EngagementForm
          action={createEngagementWithClientAction}
          clients={clients.map((c) => ({ id: c.id, name: c.displayName }))}
          staff={staff}
          initial={{ ownerId: actor.userId, taxYear: new Date().getFullYear(), proposalStatus: "not_required" }}
          cancelHref="/staff/engagements"
          submitLabel="Create engagement"
          canAssign={can(actor, "engagements", "assign")}
          actorId={actor.userId}
        />
      </Card>
    </>
  );
}
