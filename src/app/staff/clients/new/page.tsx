import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { createClientAction } from "@/app/actions/staff";
import { Card, PageHeader } from "@/components/ui";
import { requireStaffActor } from "@/lib/auth/current";
import { can } from "@/lib/auth/permissions";
import { listStaff } from "@/services/engagements";
import { ClientForm } from "../client-form";

export const metadata: Metadata = { title: "New client" };

export default async function NewClientPage() {
  const actor = await requireStaffActor();
  if (!can(actor, "clients", "create")) notFound();
  const staff = await listStaff(getDb(), actor);
  return (
    <>
      <PageHeader title="New client" description="The client starts in onboarding. Request information and documents from the client’s Overview." />
      <Card>
        <ClientForm
          action={createClientAction}
          cancelHref="/staff/clients"
          submitLabel="Create client"
          staff={staff.map((s) => ({ value: s.id, label: s.name }))}
          canAssign={can(actor, "clients", "assign")}
        />
      </Card>
    </>
  );
}
