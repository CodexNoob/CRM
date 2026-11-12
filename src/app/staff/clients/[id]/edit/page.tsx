import type { Metadata } from "next";
import { getDb } from "@/db";
import { updateClientAction } from "@/app/actions/staff";
import { Card, PageHeader } from "@/components/ui";
import { requireStaffActor } from "@/lib/auth/current";
import { orNotFound } from "@/lib/page-helpers";
import { getClient } from "@/services/clients";
import { ClientForm } from "../../client-form";

export const metadata: Metadata = { title: "Edit client" };

export default async function EditClientPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireStaffActor();
  const { id } = await params;
  const client = await orNotFound(getClient(getDb(), actor, id));
  return (
    <>
      <PageHeader title={`Edit ${client.displayName}`} />
      <Card>
        <ClientForm
          action={updateClientAction.bind(null, client.id)}
          initial={client}
          cancelHref={`/staff/clients/${client.id}`}
          submitLabel="Save changes"
        />
      </Card>
    </>
  );
}
