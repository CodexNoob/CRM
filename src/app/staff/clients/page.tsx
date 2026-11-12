import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { getDb } from "@/db";
import { ButtonLink, PageHeader } from "@/components/ui";
import { requireStaffActor } from "@/lib/auth/current";
import { listClientsOverview } from "@/services/insights";
import { ClientsTable } from "./clients-table";

export const metadata: Metadata = { title: "Clients" };

export default async function ClientsPage() {
  const actor = await requireStaffActor();
  const rows = await listClientsOverview(getDb(), actor);
  return (
    <>
      <PageHeader
        title="Clients"
        description={actor.role === "employee" ? "Clients assigned to you." : "Every individual, household and business client of the firm."}
        actions={
          <ButtonLink href="/staff/clients/new">
            <Plus /> New client
          </ButtonLink>
        }
      />
      <ClientsTable rows={rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }))} />
    </>
  );
}
