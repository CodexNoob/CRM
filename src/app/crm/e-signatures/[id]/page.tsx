import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { SimpleTable, td } from "@/components/table";
import { Alert, Badge, DescriptionList, PageHeader, Panel } from "@/components/ui";
import { dropboxSignProvider } from "@/integrations/dropbox-sign";
import { requireStaffActor } from "@/lib/auth/current";
import { can } from "@/lib/auth/permissions";
import { orNotFound } from "@/lib/page-helpers";
import { getSignatureRequest, signatureModuleState } from "@/services/esignatures";
import { SetupRequired } from "../setup-required";
import { DOCUMENT_TYPES, SIGNATURE_STATUS, SignatureControls } from "../signature-ui";

export const metadata: Metadata = { title: "Signature request" };
export const dynamic = "force-dynamic";

const fmt = (d: Date | null) => (d ? d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "—");
const SIGNER: Record<string, string> = { pending: "Not sent", sent: "Invited", viewed: "Viewed", signed: "Signed", declined: "Declined" };

export default async function SignatureRequestPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const actor = await requireStaffActor();
  if (!can(actor, "esignatures", "view")) notFound();
  const provider = dropboxSignProvider();
  const state = signatureModuleState(provider);
  if (state === "setup_required") return <SetupRequired isAdmin={actor.role === "admin"} />;
  if (state === "testing" && actor.role !== "admin") notFound();
  const { id } = await params;
  const { created } = await searchParams;
  const d = await orNotFound(getSignatureRequest(getDb(), actor, id));
  const r = d.request;
  const status = SIGNATURE_STATUS[r.status] ?? { label: r.status, tone: "neutral" as const };
  const canSend = r.status === "draft" && can(actor, "esignatures", "send") && (state === "enabled" || actor.role === "admin");
  const canVoid = ["draft", "sent", "viewed", "partially_signed"].includes(r.status) && can(actor, "esignatures", "void");
  const willTest = state !== "enabled" || provider.testMode;

  return (
    <>
      <Link href="/crm/e-signatures" className="mb-3 inline-block text-[13px] text-muted hover:text-ink">← E-Signatures</Link>
      <PageHeader
        title={r.title}
        description={`${r.requestNumber ? `R-${String(r.requestNumber).padStart(4, "0")} · ` : ""}${DOCUMENT_TYPES[r.documentType] ?? r.documentType} · ${d.clientName}`}
        actions={<SignatureControls id={r.id} canSend={canSend} canVoid={canVoid} sendLabel={willTest ? "Send test request" : "Send for signature"} testMode={willTest} />}
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <Badge tone={status.tone} dot>{status.label}</Badge>
        {r.testMode || (r.status === "draft" && willTest) ? <Badge tone="warn">Test mode — not legally binding</Badge> : null}
      </div>
      {created && r.status === "draft" ? (
        <div className="mb-4"><Alert tone="info" title="Review before sending">Check the document, signers and order below. Signers receive the invitation from Dropbox Sign once you send it.</Alert></div>
      ) : null}
      {r.status === "failed" && r.failureReason ? <div className="mb-4"><Alert tone="error">Sending failed: {r.failureReason}</Alert></div> : null}

      <div className="grid gap-5 xl:grid-cols-[1fr_22rem]">
        <div className="space-y-5">
          <Panel title="Signers" flush>
            <SimpleTable label="Signers" headers={[{ label: "Order" }, { label: "Signer" }, { label: "Role", hideBelow: "md" }, { label: "Status" }, { label: "Signed", hideBelow: "md" }]}>
              {d.signers.map((s) => (
                <tr key={s.id}>
                  <td className={`${td} tabular`}>{s.signingOrder}</td>
                  <td className={td}><div className="font-medium text-ink">{s.name}</div><div className="text-[12px] text-muted">{s.email}</div></td>
                  <td className={`${td} hidden text-muted md:table-cell`}>{s.role ?? "—"}</td>
                  <td className={td}><Badge tone={s.status === "signed" ? "good" : s.status === "declined" ? "danger" : s.status === "viewed" ? "info" : "neutral"}>{SIGNER[s.status] ?? s.status}</Badge></td>
                  <td className={`${td} hidden text-muted md:table-cell`}>{fmt(s.signedAt ?? s.declinedAt)}</td>
                </tr>
              ))}
            </SimpleTable>
          </Panel>
          <Panel title="Signing history" description="Verified events received from Dropbox Sign (each recorded once)." flush>
            {d.events.length ? (
              <SimpleTable label="Signing history" headers={[{ label: "Event" }, { label: "When" }]}>
                {d.events.map((e) => (
                  <tr key={e.id}>
                    <td className={td}>{e.eventType.replace(/^signature_request_/, "").replace(/_/g, " ")}</td>
                    <td className={`${td} text-muted`}>{fmt(e.occurredAt ?? e.receivedAt)}</td>
                  </tr>
                ))}
              </SimpleTable>
            ) : (
              <p className="px-4 py-6 text-center text-[13px] text-muted">{r.status === "draft" ? "Not sent yet." : "No events received from Dropbox Sign yet."}</p>
            )}
          </Panel>
        </div>
        <Panel title="Details">
          <DescriptionList
            columns={1}
            items={[
              ["Client", <Link key="c" href={`/crm/clients/${r.clientId}`} className="hover:underline">{d.clientName}</Link>],
              ["Engagement", d.engagement ? <Link key="e" href={`/crm/engagements/${d.engagement.id}`} className="hover:underline">{d.engagement.title}</Link> : "—"],
              ["Document", d.document ? <a key="d" href={`/api/documents/${d.document.id}`} className="hover:underline">{d.document.fileName}</a> : "—"],
              ["Signed copy", d.signedDocument ? <a key="s" href={`/api/documents/${d.signedDocument.id}`} className="hover:underline">{d.signedDocument.fileName}</a> : r.status === "signed" ? "Retrieving…" : "—"],
              ["Provider", "Dropbox Sign"],
              ["Provider reference", r.providerRequestId ?? "—"],
              ["Sent", fmt(r.sentAt)],
              ["Expires", fmt(r.expiresAt)],
              ["Completed", fmt(r.completedAt)],
            ]}
          />
        </Panel>
      </div>
    </>
  );
}
