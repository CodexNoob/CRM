import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { updateClientAction } from "@/app/actions/staff";
import { Card, PageHeader } from "@/components/ui";
import { requireStaffActor } from "@/lib/auth/current";
import { can } from "@/lib/auth/permissions";
import { orNotFound } from "@/lib/page-helpers";
import { getClient } from "@/services/clients";
import { listStaff } from "@/services/engagements";
import { ClientForm } from "../../client-form";

export const metadata: Metadata = { title: "Edit client" };

export default async function EditClientPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireStaffActor();
  if (!can(actor, "clients", "edit")) notFound();
  const { id } = await params;
  const db = getDb();
  const [client, staff] = await Promise.all([orNotFound(getClient(db, actor, id)), listStaff(db, actor)]);
  return (
    <>
      <PageHeader title={`Edit ${client.displayName}`} />
      <Card>
        <ClientForm
          action={updateClientAction.bind(null, client.id)}
          initial={client}
          cancelHref={`/staff/clients/${client.id}`}
          submitLabel="Save changes"
          staff={staff.map((s) => ({ value: s.id, label: s.name }))}
          canAssign={can(actor, "clients", "assign")}
        />
      </Card>
    </>
  );
}
