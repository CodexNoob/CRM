import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { PageHeader, Panel } from "@/components/ui";
import { dropboxSignProvider } from "@/integrations/dropbox-sign";
import { requireStaffActor } from "@/lib/auth/current";
import { can } from "@/lib/auth/permissions";
import { listSignatureFormOptions, signatureModuleState } from "@/services/esignatures";
import { SetupRequired } from "../setup-required";
import { NewSignatureForm } from "../signature-ui";

export const metadata: Metadata = { title: "New signature request" };
export const dynamic = "force-dynamic";

export default async function NewSignaturePage() {
  const actor = await requireStaffActor();
  if (!can(actor, "esignatures", "create")) notFound();
  const state = signatureModuleState(dropboxSignProvider());
  if (state === "setup_required") return <SetupRequired isAdmin={actor.role === "admin" || actor.role === "administrator"} />;
  if (state === "testing" && actor.role !== "admin" && actor.role !== "administrator") notFound();
  const options = await listSignatureFormOptions(getDb(), actor);
  return (
    <>
      <Link href="/crm/e-signatures" className="mb-3 inline-block text-[13px] text-muted hover:text-ink">← E-Signatures</Link>
      <PageHeader title="New signature request" description="Saved as a draft first. You’ll review it before anything is sent." />
      <Panel className="max-w-3xl">
        <NewSignatureForm clients={options.clients} documents={options.documents} engagements={options.engagements} canUpload={can(actor, "documents", "upload")} />
      </Panel>
    </>
  );
}
