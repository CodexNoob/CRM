import type { Metadata } from "next";
import { createClientAction } from "@/app/actions/staff";
import { Card, PageHeader } from "@/components/ui";
import { requireStaffActor } from "@/lib/auth/current";
import { ClientForm } from "../client-form";

export const metadata: Metadata = { title: "New client" };

export default async function NewClientPage() {
  await requireStaffActor();
  return (
    <>
      <PageHeader title="New client" />
      <Card>
        <ClientForm action={createClientAction} cancelHref="/staff/clients" submitLabel="Create client" />
      </Card>
    </>
  );
}
