import type { Metadata } from "next";
import Link from "next/link";
import { CreditCard, Receipt, Repeat } from "lucide-react";
import { getDb } from "@/db";
import { InvoiceTable } from "@/components/invoice-table";
import { ButtonLink, cx, EmptyState, PageHeader, Panel, StatStrip } from "@/components/ui";
import { isManagerOrAdmin } from "@/lib/auth/actor";
import { requireStaffActor } from "@/lib/auth/current";
import { formatMoney } from "@/lib/labels";
import { firmToday } from "@/services/dashboard";
import { invoiceTotals, listInvoices, paypalProvider } from "@/services/invoices";
import { listSubscriptions } from "@/services/subscriptions";
import { SubscriptionTable } from "@/components/subscription-table";

export const metadata: Metadata = { title: "Invoices & Billing" };
export const dynamic = "force-dynamic";

const FILTERS = [
  { key: "open", label: "Awaiting payment" },
  { key: "paid", label: "Paid" },
  { key: "draft", label: "Drafts" },
  { key: "all", label: "All" },
] as const;

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const actor = await requireStaffActor();
  const requested = (await searchParams).status;
  const filter = FILTERS.find((f) => f.key === requested)?.key ?? "open";
  const db = getDb();
  const provider = paypalProvider();
  const today = firmToday();
  // List first: it refreshes stale statuses from PayPal, so the totals below are current.
  const rows = await listInvoices(db, actor, { status: filter === "all" ? undefined : filter }, provider);
  const [totals, subs] = await Promise.all([invoiceTotals(db, actor, today), listSubscriptions(db, actor)]);
  const activeSubs = subs.filter((s) => s.status === "active");
  const monthlyRecurring = activeSubs.reduce((sum, s) => sum + (s.interval === "year" ? Math.round(s.amountCents / 12) : s.amountCents), 0);

  return (
    <>
      <PageHeader
        title="Invoices & Billing"
        description={`Invoices are created and paid through PayPal${provider.isConfigured ? "" : " (not connected)"}. To bill someone, open their client record and choose the Billing tab.`}
      />
      {!provider.isConfigured ? (
        <Panel className="mb-5">
          <EmptyState icon={<CreditCard />} title="PayPal not connected" action={<ButtonLink href="/staff/integrations" variant="secondary" size="sm">View integrations</ButtonLink>}>
            Add PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET to the server settings to create and track invoices.
          </EmptyState>
        </Panel>
      ) : null}
      <StatStrip
        className="mb-5"
        items={[
          { label: "Outstanding", value: formatMoney(totals.outstandingCents), tone: totals.outstandingCents ? "warning" : "default" },
          { label: "Awaiting payment", value: totals.openCount, href: "/staff/invoices?status=open" },
          { label: "Overdue", value: totals.overdueCount, tone: totals.overdueCount ? "danger" : "default" },
          { label: "Paid (last 30 days)", value: formatMoney(totals.paidLast30Cents), tone: "success" },
          { label: "Active subscriptions", value: activeSubs.length, hint: activeSubs.length ? `≈ ${formatMoney(monthlyRecurring)} / month` : undefined },
        ]}
      />
      <Panel
        title="Invoices"
        flush
        actions={
          <nav aria-label="Filter invoices" className="flex flex-wrap gap-1">
            {FILTERS.map((f) => (
              <Link
                key={f.key}
                href={`/staff/invoices?status=${f.key}`}
                aria-current={filter === f.key ? "page" : undefined}
                className={cx("rounded-md px-2.5 py-1 text-[12.5px]", filter === f.key ? "bg-brand-soft font-medium text-brand-ink" : "text-muted hover:bg-subtle hover:text-ink")}
              >
                {f.label}
              </Link>
            ))}
          </nav>
        }
      >
        {rows.length ? (
          <InvoiceTable rows={rows} showClient canCancel={isManagerOrAdmin(actor)} today={today} />
        ) : (
          <EmptyState icon={<Receipt />} title={filter === "open" ? "Nothing awaiting payment" : "No invoices here"} action={<ButtonLink href="/staff/clients" variant="secondary" size="sm">Go to clients</ButtonLink>}>
            Create an invoice from a client’s record, on the Billing tab.
          </EmptyState>
        )}
      </Panel>
      <Panel title="Subscriptions" description="Recurring monthly or yearly billing. Set one up from a client’s Billing tab." flush className="mt-5">
        {subs.length ? (
          <SubscriptionTable rows={subs} showClient canCancel={isManagerOrAdmin(actor)} />
        ) : (
          <EmptyState icon={<Repeat />} title="No subscriptions yet">
            Open a client’s record, choose the Billing tab, and use “New subscription”.
          </EmptyState>
        )}
      </Panel>
    </>
  );
}
