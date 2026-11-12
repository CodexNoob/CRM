import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db";
import { Card, PageHeader, StatStrip, buttonClass } from "@/components/ui";
import { requireStaffActor } from "@/lib/auth/current";
import { TAX_PREPARATION_STATUS_LABELS } from "@/lib/labels";
import { firmToday } from "@/services/dashboard";
import { listClients } from "@/services/clients";
import { listStaff } from "@/services/engagements";
import { listWork, TAX_SERVICES } from "@/services/practice";
import { listTaxDocumentTemplates, listTaxPreparationCases } from "@/services/tax";
import { can } from "@/lib/auth/permissions";
import { TaxPreparationCasesTable } from "./cases-table";
import { CreateTaxDocumentTemplateForm, CreateTaxPreparationForm } from "./tax-forms";

export const metadata: Metadata = { title: "Tax Preparation" };

export default async function TaxPreparationPage() {
  const actor = await requireStaffActor();
  const db = getDb();
  const [cases, clients, staff, engagements, templates] = await Promise.all([
    listTaxPreparationCases(db, actor),
    listClients(db, actor),
    listStaff(db, actor),
    listWork(db, actor, { services: TAX_SERVICES }),
    listTaxDocumentTemplates(db, actor),
  ]);
  const today = firmToday();
  const open = cases.filter((c) => c.status !== "completed");
  const overdue = open.filter((c) => c.dueDate && c.dueDate < today);
  const mine = cases.filter((c) => c.preparerName === actor.name || c.reviewerName === actor.name);
  const staffOptions = staff.filter((s) => s.role !== "read_only").map((s) => ({ id: s.id, name: s.name }));

  return (
    <>
      <PageHeader title="Tax Preparation" description="Production cases, document requirements, assignments, and review readiness." />
      <StatStrip className="mb-5" items={[
        { label: "Total cases", value: cases.length },
        { label: "Waiting for documents", value: cases.filter((c) => ["documents_requested", "awaiting_documents"].includes(c.status)).length, tone: "warning" },
        { label: "Ready for preparation", value: cases.filter((c) => c.status === "ready_for_preparation").length },
        { label: "In preparation", value: cases.filter((c) => c.status === "in_preparation").length },
        { label: "Under review", value: cases.filter((c) => c.status === "internal_review").length },
        { label: "Overdue", value: overdue.length, tone: overdue.length ? "danger" : "default" },
      ]} />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Card title="Preparation cases" description="Searchable cases use assigned-staff visibility and retain their own lifecycle separate from engagements." flush>
          <TaxPreparationCasesTable cases={cases} today={today} />
        </Card>
        <div className="space-y-5">
          <Card title="New preparation case">
            <CreateTaxPreparationForm
              clients={clients.map((c) => ({ id: c.id, name: c.displayName }))}
              engagements={engagements.map((e) => ({ id: e.id, clientId: e.clientId, title: e.title, clientName: e.clientName, serviceType: e.serviceType }))}
              staff={staffOptions}
              defaultTaxYear={new Date().getFullYear() - 1}
            />
          </Card>
          {can(actor, "tax_preparation", "manage") ? (
            <Card title="Document requirements" description={`${templates.length} active requirements. New cases receive matching requirements.`}>
              <details>
                <summary className={buttonClass("secondary", "cursor-pointer list-none")}>Configure a requirement</summary>
                <div className="mt-4"><CreateTaxDocumentTemplateForm /></div>
              </details>
            </Card>
          ) : null}
          <Card title="My assigned cases">
            {mine.length ? <ul className="space-y-2 text-[13px]">{mine.slice(0, 6).map((c) => (
              <li key={c.id}><Link href={`/staff/tax-preparation/${c.id}`} className="font-medium text-ink hover:underline">{c.clientName}</Link><span className="text-muted"> · {c.taxYear} · {TAX_PREPARATION_STATUS_LABELS[c.status]}</span></li>
            ))}</ul> : <p className="text-[13px] text-muted">No cases assigned to you.</p>}
          </Card>
        </div>
      </div>
    </>
  );
}
