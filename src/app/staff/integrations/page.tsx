import type { Metadata } from "next";
import { sql } from "drizzle-orm";
import { CreditCard, Database, FileSignature, Mail, Receipt, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { getDb } from "@/db";
import { SimpleTable, td, tdHide } from "@/components/table";
import { Alert, Badge, PageHeader, Panel, StatStrip } from "@/components/ui";
import { readQboConfig } from "@/integrations/qbo";
import { paypalConfig } from "@/integrations/paypal";
import { emailConfig } from "@/integrations/email";
import { dropboxSignConfig } from "@/integrations/dropbox-sign";
import { requireStaffActor } from "@/lib/auth/current";
import { requirePermission } from "@/services/access";
import { getQboConnectionView, qboFirmFinancialActionsEnabled } from "@/services/qbo-connections";
import { QboConnectionControls } from "./qbo-controls";

export const metadata: Metadata = { title: "Integrations" };
export const dynamic = "force-dynamic";

type Status = "connected" | "not_connected" | "error";

async function databaseStatus(): Promise<{ status: Status; detail: string }> {
  const url = process.env.DATABASE_URL ?? "";
  try {
    await getDb().execute(sql`select 1`);
    if (url.startsWith("pglite:")) return { status: "connected", detail: "Local embedded database (development only)" };
    const host = new URL(url).hostname;
    return { status: "connected", detail: `${host.includes("supabase") ? "Supabase PostgreSQL" : "PostgreSQL"} · TLS ${process.env.DATABASE_SSL ?? "verify"}` };
  } catch {
    return { status: "error", detail: "The database could not be reached" };
  }
}

export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<{ qbo?: string }> }) {
  const actor = await requireStaffActor();
  requirePermission(actor, "integrations", "view");
  const { qbo: qboResult } = await searchParams;
  const db = await databaseStatus();
  const qbo = readQboConfig();
  const qboView = await getQboConnectionView(getDb(), { type: "firm", firmId: actor.firmId });
  const paypal = paypalConfig();
  const email = emailConfig();
  const sign = dropboxSignConfig();

  const rows: { name: string; icon: ReactNode; purpose: string; status: Status; detail: string }[] = [
    { name: "Database", icon: <Database />, purpose: "All CRM, portal and website data", ...db },
    {
      name: "QuickBooks Online",
      icon: <Receipt />,
      purpose: "Firm invoices and client payments",
      status: qboView.status === "connected" ? "connected" : qboView.status === "reauthorization_required" || qboView.status === "expired" ? "error" : "not_connected",
      detail: qboView.companyName ?? (qbo.clientId && qbo.clientSecret ? "Intuit app configured; connect a company" : "Needs an Intuit developer app, token-encryption key, and company connection"),
    },
    {
      name: "PayPal",
      icon: <CreditCard />,
      purpose: "CRM subscription checkout and recurring fees",
      status: paypal.isConfigured && paypal.isWebhookConfigured ? "connected" : "not_connected",
      detail: !paypal.isConfigured
        ? paypal.configurationMessage ?? "Configure the PayPal API credentials"
        : !paypal.isWebhookConfigured
          ? "API configured; add the PayPal webhook ID to enable checkout"
          : `Subscription billing · ${paypal.environment}`,
    },
    {
      name: "Email delivery",
      icon: <Mail />,
      purpose: "Invitations, message alerts, inquiry notifications",
      status: email.isConfigured ? "connected" : "not_connected",
      detail: email.isConfigured
        ? `Resend · website inquiry alerts${email.inquiryTo ? "" : " (no recipient set)"}; invitations are still shared manually`
        : "No email service configured; links are shared manually",
    },
    { name: "Malware scanning", icon: <ShieldCheck />, purpose: "Scan every uploaded document", status: "not_connected", detail: "No scanner connected; files show “Not scanned”" },
    {
      name: "Dropbox Sign (e-signatures)",
      icon: <FileSignature />,
      purpose: "Engagement letters, authorizations, consent forms",
      status: sign.isConfigured ? "connected" : "not_connected",
      detail: !sign.isConfigured
        ? "Not connected: add DROPBOX_SIGN_API_KEY and the webhook URL"
        : sign.isEnabled
          ? `Enabled${sign.testMode ? " · test mode (not legally binding)" : ""}`
          : "Connected – testing (admins only, test mode)",
    },
  ];
  const connected = rows.filter((r) => r.status === "connected").length;

  return (
    <>
      <PageHeader title="Integrations" description="Live status of the services the CRM depends on." />
      {qboResult === "connected" ? <div className="mb-4"><Alert tone="success">QuickBooks company connected. Verify the company and select its invoice service item before billing.</Alert></div> : null}
      {qboResult === "cancelled" ? <div className="mb-4"><Alert tone="info">QuickBooks connection was cancelled. No company was linked.</Alert></div> : null}
      {qboResult === "error" ? <div className="mb-4"><Alert tone="error">QuickBooks could not complete the connection. Confirm Intuit app credentials and the exact callback URI, then try again. No credentials or authorization details were logged.</Alert></div> : null}
      <StatStrip
        className="mb-5"
        items={[
          { label: "Connected", value: connected, tone: "success" },
          { label: "Not connected", value: rows.filter((r) => r.status === "not_connected").length },
          { label: "Errors", value: rows.filter((r) => r.status === "error").length, tone: rows.some((r) => r.status === "error") ? "danger" : "default" },
          { label: "Total services", value: rows.length },
        ]}
      />
      <Panel title="Services" flush>
        <SimpleTable label="Integrations" headers={[{ label: "Service" }, { label: "Used for", hideBelow: "md" }, { label: "Detail", hideBelow: "lg" }, { label: "Status", align: "right" }]}>
          {rows.map((r) => (
            <tr key={r.name}>
              <td className={td}>
                <div className="flex items-center gap-2.5">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-line bg-subtle text-muted [&_svg]:size-3.5">{r.icon}</span>
                  <span className="font-medium text-ink">{r.name}</span>
                </div>
              </td>
              <td className={`${td} ${tdHide.md} text-muted`}>{r.purpose}</td>
              <td className={`${td} ${tdHide.lg} text-muted`}>{r.detail}</td>
              <td className={`${td} text-right`}>
                <Badge tone={r.status === "connected" ? "good" : r.status === "error" ? "danger" : "neutral"} dot>
                  {r.status === "connected" ? "Connected" : r.status === "error" ? "Error" : "Not connected"}
                </Badge>
              </td>
            </tr>
          ))}
        </SimpleTable>
      </Panel>
      <Panel title="Firm QuickBooks Online" description="This connection is only for this firm's accounting and client billing. Customer matching is explicit; the CRM never creates duplicate customers.">
        <div className="space-y-5">
          <div>
            <h2 className="mb-2 text-[13px] font-semibold">This firm’s company</h2>
            <QboConnectionControls
              view={qboView}
              canManage={actor.role === "admin"}
              environment={qbo.environment}
              financialActionsEnabled={qboFirmFinancialActionsEnabled()}
            />
          </div>
        </div>
      </Panel>
    </>
  );
}
