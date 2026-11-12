import type { Metadata } from "next";
import { getDb } from "@/db";
import { createEngagementAction } from "@/app/actions/staff";
import { Card, PageHeader } from "@/components/ui";
import { requireStaffActor } from "@/lib/auth/current";
import { orNotFound } from "@/lib/page-helpers";
import { getClient } from "@/services/clients";
import { listStaff } from "@/services/engagements";
import { EngagementForm } from "../../../../engagement-form";

export const metadata: Metadata = { title: "New engagement" };

export default async function NewEngagementPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireStaffActor();
  const { id } = await params;
  const db = getDb();
  const client = await orNotFound(getClient(db, actor, id));
  const staff = await listStaff(db, actor);
  return (
    <>
      <PageHeader title="New engagement" description={`For ${client.displayName}`} />
      <Card className="max-w-2xl">
        <EngagementForm
          action={createEngagementAction.bind(null, client.id)}
          staff={staff}
          initial={{ ownerId: actor.userId, taxYear: new Date().getFullYear() }}
          cancelHref={`/staff/clients/${client.id}`}
          submitLabel="Create engagement"
        />
      </Card>
    </>
  );
}
