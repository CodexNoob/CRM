import type { Metadata } from "next";
import { getDb } from "@/db";
import { ButtonLink, PageHeader, StatStrip } from "@/components/ui";
import { requireStaffActor } from "@/lib/auth/current";
import { listTaxReturns } from "@/services/tax";
import { TaxReturnsTable } from "./returns-table";

export const metadata: Metadata = { title: "Tax Returns" };

export default async function TaxReturnsPage() {
  const actor = await requireStaffActor();
  const returns = await listTaxReturns(getDb(), actor);

  return (
    <>
      <PageHeader
        title="Tax Returns"
        description="Return records with separate preparation, review, authorization, filing, and authority-response states."
        actions={<ButtonLink href="/staff/tax-preparation" variant="secondary">Preparation workspace</ButtonLink>}
      />
      <StatStrip className="mb-5" items={[
        { label: "Total returns", value: returns.length },
        { label: "In preparation", value: returns.filter((r) => ["not_started", "waiting_for_documents", "in_preparation"].includes(r.status)).length },
        { label: "Under review", value: returns.filter((r) => ["ready_for_review", "under_review", "changes_required"].includes(r.status)).length },
        { label: "Awaiting authorization", value: returns.filter((r) => r.status === "awaiting_client_approval").length, tone: "warning" },
        { label: "Filed, awaiting response", value: returns.filter((r) => r.filingStatus === "filed").length },
        { label: "Accepted", value: returns.filter((r) => r.filingStatus === "accepted").length, tone: "success" },
      ]} />
      <p className="mb-4 text-xs text-muted">Recording a filing stores the actual date and reference provided by staff; it does not electronically file the return. Filed does not mean accepted.</p>
      <TaxReturnsTable returns={returns} />
    </>
  );
}
