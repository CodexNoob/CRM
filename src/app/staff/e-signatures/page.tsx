import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { Alert, Badge, ButtonLink, PageHeader, Panel, StatStrip } from "@/components/ui";
import { dropboxSignConfig, dropboxSignProvider } from "@/integrations/dropbox-sign";
import { requireStaffActor } from "@/lib/auth/current";
import { can } from "@/lib/auth/permissions";
import { listSignatureRequests, signatureModuleState } from "@/services/esignatures";
import { SetupRequired } from "./setup-required";
import { SignatureTable } from "./signature-ui";

export const metadata: Metadata = { title: "E-Signatures" };
export const dynamic = "force-dynamic";

export default async function ESignaturesPage() {
  const actor = await requireStaffActor();
  if (!can(actor, "esignatures", "view")) notFound();
  const state = signatureModuleState(dropboxSignProvider());
  const isAdmin = actor.role === "admin";

  if (state === "setup_required") {
    return (
      <>
        <PageHeader title="E-Signatures" description="Engagement letters, authorizations and consent forms, signed through Dropbox Sign." />
        <SetupRequired isAdmin={isAdmin} />
      </>
    );
  }
  if (state === "testing" && !isAdmin) {
    return (
      <>
        <PageHeader title="E-Signatures" description="Engagement letters, authorizations and consent forms, signed through Dropbox Sign." />
        <Alert tone="info">E-signatures are being tested by your firm admin and aren’t available yet.</Alert>
      </>
    );
  }

  const rows = await listSignatureRequests(getDb(), actor);
  const canCreate = can(actor, "esignatures", "create");
  const cfg = dropboxSignConfig();
  return (
    <>
      <PageHeader
        title="E-Signatures"
        description="Engagement letters, authorizations and consent forms, signed through Dropbox Sign."
        actions={canCreate ? <ButtonLink href="/staff/e-signatures/new">New signature request</ButtonLink> : undefined}
      />
      {state === "testing" ? (
        <div className="mb-4">
          <Alert tone="warning" title="Testing — enable after a successful test">
            Requests are sent in <strong>test mode</strong> and are <strong>not legally binding</strong>. Only admins can send. Set <code>DROPBOX_SIGN_ENABLED=1</code> once a test request completes here.
          </Alert>
        </div>
      ) : cfg.testMode ? (
        <div className="mb-4">
          <Alert tone="warning">Test mode is on (<code>DROPBOX_SIGN_TEST_MODE=1</code>): requests are not legally binding.</Alert>
        </div>
      ) : null}
      <StatStrip
        className="mb-5"
        items={[
          { label: "Awaiting signature", value: rows.filter((r) => ["sent", "viewed", "partially_signed"].includes(r.status)).length, tone: "warning" },
          { label: "Signed", value: rows.filter((r) => r.status === "signed").length, tone: "success" },
          { label: "Drafts", value: rows.filter((r) => r.status === "draft").length },
          { label: "Declined / expired / failed", value: rows.filter((r) => ["declined", "expired", "failed"].includes(r.status)).length, tone: "danger" },
        ]}
      />
      <Panel title="Signature requests" flush actions={<Badge tone={state === "enabled" ? "good" : "warn"} dot>{state === "enabled" ? "Dropbox Sign connected" : "Testing"}</Badge>}>
        <SignatureTable
          rows={rows.map((r) => ({
            id: r.id,
            number: r.requestNumber ? `R-${String(r.requestNumber).padStart(4, "0")}` : "",
            title: r.title,
            documentType: r.documentType,
            status: r.status,
            testMode: r.testMode,
            clientName: r.clientName,
            sentAt: r.sentAt?.toISOString() ?? null,
            expiresAt: r.expiresAt?.toISOString() ?? null,
            completedAt: r.completedAt?.toISOString() ?? null,
            signerCount: r.signerCount,
            signedCount: r.signedCount,
          }))}
        />
      </Panel>
    </>
  );
}
