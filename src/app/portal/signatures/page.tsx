import type { Metadata } from "next";
import { FileSignature } from "lucide-react";
import { getDb } from "@/db";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { dropboxSignProvider } from "@/integrations/dropbox-sign";
import { requirePortalContext } from "@/lib/auth/portal-context";
import { listPortalSignatureRequests, signatureModuleState } from "@/services/esignatures";

export const metadata: Metadata = { title: "Signature Requests" };
export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; tone: "info" | "warn" | "good" | "danger" | "neutral" }> = {
  sent: { label: "Waiting for signature", tone: "warn" },
  viewed: { label: "Waiting for signature", tone: "warn" },
  partially_signed: { label: "Partially signed", tone: "info" },
  signed: { label: "Signed", tone: "good" },
  declined: { label: "Declined", tone: "danger" },
  expired: { label: "Expired", tone: "neutral" },
  voided: { label: "Cancelled", tone: "neutral" },
  failed: { label: "Problem — the firm will follow up", tone: "neutral" },
};
const SIGNER: Record<string, string> = { pending: "Not sent yet", sent: "Waiting", viewed: "Opened", signed: "Signed", declined: "Declined" };
const day = (d: Date | null) => (d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null);

export default async function PortalSignaturesPage() {
  // Client id comes from the server-resolved portal context — never from the URL.
  const ctx = await requirePortalContext();
  if (signatureModuleState(dropboxSignProvider()) !== "enabled") {
    return (
      <>
        <PageHeader title="Signature Requests" />
        <Card>
          <EmptyState icon={<FileSignature />} title="Electronic signatures aren’t available yet">
            When your firm sends you a document to sign, it will appear here.
          </EmptyState>
        </Card>
      </>
    );
  }
  const requests = await listPortalSignatureRequests(getDb(), ctx.actor, ctx.client.clientId);
  return (
    <>
      <PageHeader title="Signature Requests" description="Documents your firm has sent you to sign. Signing happens securely on Dropbox Sign." />
      <Card>
        {requests.length ? (
          <ul className="divide-y divide-line">
            {requests.map((r) => {
              const s = STATUS[r.status] ?? { label: r.status, tone: "neutral" as const };
              const waitingOnMe = r.signers.some((x) => x.mine && ["sent", "viewed"].includes(x.status)) && ["sent", "viewed", "partially_signed"].includes(r.status);
              return (
                <li key={r.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-ink">{r.title}</p>
                    <Badge tone={s.tone}>{s.label}</Badge>
                    {r.testMode ? <Badge tone="warn">Test — not binding</Badge> : null}
                  </div>
                  <p className="text-[13px] text-muted">
                    {r.sentAt ? `Sent ${day(r.sentAt)}` : ""}
                    {r.expiresAt && !r.completedAt ? ` · Expires ${day(r.expiresAt)}` : ""}
                    {r.completedAt ? ` · Completed ${day(r.completedAt)}` : ""}
                  </p>
                  <ul className="mt-2 flex flex-wrap gap-2 text-[12px]">
                    {r.signers.map((x) => (
                      <li key={x.id} className="rounded border border-line px-2 py-0.5">
                        {x.name}
                        {x.mine ? " (you)" : ""}: {SIGNER[x.status] ?? x.status}
                      </li>
                    ))}
                  </ul>
                  {waitingOnMe ? (
                    <p className="mt-2 text-[13px] text-ink">Check your email for the signing invitation from Dropbox Sign, then follow the link to review and sign.</p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState icon={<FileSignature />} title="No signature requests">
            When your firm sends you a document to sign, it will appear here.
          </EmptyState>
        )}
      </Card>
    </>
  );
}
