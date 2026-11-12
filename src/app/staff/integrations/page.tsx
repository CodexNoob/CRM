import type { Metadata } from "next";
import { sql } from "drizzle-orm";
import { CreditCard, Database, FileSignature, Mail, Receipt, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { getDb } from "@/db";
import { SimpleTable, td, tdHide } from "@/components/table";
import { Badge, PageHeader, Panel, StatStrip } from "@/components/ui";
import { getAccountingProvider } from "@/integrations/qbo";
import { emailConfig } from "@/integrations/email";
import { paypalConfig } from "@/integrations/paypal";
import { requireStaffActor } from "@/lib/auth/current";

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

export default async function IntegrationsPage() {
  await requireStaffActor();
  const db = await databaseStatus();
  const qbo = getAccountingProvider();
  const email = emailConfig();
  const pp = paypalConfig();

  const rows: { name: string; icon: ReactNode; purpose: string; status: Status; detail: string }[] = [
    { name: "Database", icon: <Database />, purpose: "All CRM, portal and website data", ...db },
    {
      name: "QuickBooks Online",
      icon: <Receipt />,
      purpose: "Accounting and bookkeeping sync (optional; invoices use PayPal)",
      status: qbo.isConfigured ? "connected" : "not_connected",
      detail: process.env.QBO_CLIENT_ID ? "Credentials found; the OAuth connection is not built yet" : "Needs an Intuit developer app and OAuth connection",
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
    { name: "E-signature provider", icon: <FileSignature />, purpose: "Engagement letters, Form 8879", status: "not_connected", detail: "Provider not selected" },
    {
      name: "PayPal",
      icon: <CreditCard />,
      purpose: "Invoices and client payments (card or PayPal)",
      status: pp.isConfigured ? "connected" : "not_connected",
      detail: pp.isConfigured
        ? `${pp.environment === "live" ? "Live" : "Sandbox (test mode, no real money)"} · ${pp.currency}; card data never reaches this app`
        : "Add PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET; card data never reaches this app",
    },
  ];
  const connected = rows.filter((r) => r.status === "connected").length;

  return (
    <>
      <PageHeader title="Integrations" description="Live status of the services the CRM depends on." />
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
    </>
  );
}
