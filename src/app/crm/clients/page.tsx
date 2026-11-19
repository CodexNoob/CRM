import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { getDb } from "@/db";
import { ButtonLink, PageHeader } from "@/components/ui";
import type { ClientStatus, ClientType, OnboardingStatus } from "@/db/schema";
import { requireStaffActor } from "@/lib/auth/current";
import { can } from "@/lib/auth/permissions";
import { CLIENT_STATUS_LABELS, CLIENT_TYPE_LABELS, ONBOARDING_STATUS_LABELS } from "@/lib/labels";
import { listClientRows } from "@/services/client-overview";
import { listStaff } from "@/services/engagements";
import { ClientFilters } from "./client-filters";
import { ClientsTable } from "./clients-table";

export const metadata: Metadata = { title: "Clients" };

type Search = { type?: string; status?: string; manager?: string; onboarding?: string; archived?: string };

const pick = <T extends string>(v: string | undefined, allowed: Record<T, string>): T | undefined => (v && v in allowed ? (v as T) : undefined);

export default async function ClientsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const actor = await requireStaffActor();
  const sp = await searchParams;
  const filters = {
    type: pick<ClientType>(sp.type, CLIENT_TYPE_LABELS),
    status: pick<ClientStatus>(sp.status, CLIENT_STATUS_LABELS),
    onboarding: pick<OnboardingStatus>(sp.onboarding, ONBOARDING_STATUS_LABELS),
    manager: sp.manager || undefined,
    archived: sp.archived === "1",
  };
  const db = getDb();
  const [rows, staff] = await Promise.all([listClientRows(db, actor, filters), listStaff(db, actor)]);
  const canCreate = can(actor, "clients", "create");

  return (
    <>
      <PageHeader
        title="Clients"
        description={["employee", "team_member", "sales_representative", "account_manager", "support_agent"].some((role) => role === actor.role) ? "Clients assigned to you." : "Every individual, household and business client of the firm."}
        actions={
          canCreate ? (
            <ButtonLink href="/crm/clients/new">
              <Plus /> New client
            </ButtonLink>
          ) : undefined
        }
      />
      <ClientFilters
        values={{ type: filters.type ?? "", status: filters.status ?? "", manager: filters.manager ?? "", onboarding: filters.onboarding ?? "", archived: filters.archived }}
        staff={staff.map((s) => ({ value: s.id, label: s.name }))}
      />
      <ClientsTable
        key={JSON.stringify(filters)}
        archivedView={filters.archived}
        canArchive={can(actor, "clients", "delete")}
        canCreate={canCreate}
        rows={rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), archivedAt: r.archivedAt?.toISOString() ?? null }))}
      />
    </>
  );
}
