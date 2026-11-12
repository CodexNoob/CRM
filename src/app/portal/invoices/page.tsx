import type { Metadata } from "next";
import { Receipt } from "lucide-react";
import { getDb } from "@/db";
import { SubscribeButton } from "@/components/invoice-client";
import { Alert, Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireClientActor } from "@/lib/auth/current";
import { formatDate, formatMoney } from "@/lib/labels";
import { listPortalInvoices } from "@/services/invoices";
import { listPortalSubscriptions } from "@/services/subscriptions";

export const metadata: Metadata = { title: "Billing" };
export const dynamic = "force-dynamic";

const CLIENT_STATUS: Record<string, { label: string; tone: "warn" | "info" | "good" | "neutral" }> = {
  sent: { label: "Due", tone: "warn" },
  partially_paid: { label: "Partially paid", tone: "info" },
  paid: { label: "Paid", tone: "good" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  refunded: { label: "Refunded", tone: "neutral" },
};

const SUB_STATUS: Record<string, { label: string; tone: "warn" | "good" | "danger" | "neutral" }> = {
  pending: { label: "Not started", tone: "warn" },
  active: { label: "Active", tone: "good" },
  suspended: { label: "Payment problem", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  expired: { label: "Ended", tone: "neutral" },
};

const day = (d: Date | null) => (d ? formatDate(d.toISOString().slice(0, 10)) : null);

export default async function PortalInvoicesPage({ searchParams }: { searchParams: Promise<{ subscribed?: string }> }) {
  const actor = await requireClientActor();
  const { subscribed } = await searchParams;
  const [invoices, subs] = await Promise.all([listPortalInvoices(getDb(), actor), listPortalSubscriptions(getDb(), actor)]);
  const open = invoices.filter((i) => i.payUrl);
  const past = invoices.filter((i) => !i.payUrl);
  const shownSubs = subs.filter((s) => s.status !== "cancelled" && s.status !== "expired");

  return (
    <>
      <PageHeader title="Billing" description="Pay invoices and manage subscriptions securely through PayPal (card or PayPal account). Your card details never reach us." />
      <div className="space-y-6">
        {subscribed === "1" ? (
          <Alert tone="success" title="Thank you">
            Your subscription is being set up. It can take a minute for PayPal to confirm; this page updates automatically.
          </Alert>
        ) : subscribed === "0" ? (
          <Alert tone="info">You left PayPal before finishing. Nothing was charged. You can subscribe again any time.</Alert>
        ) : null}

        {shownSubs.length ? (
          <Card title="Subscriptions">
            <ul className="divide-y divide-line">
              {shownSubs.map((s) => {
                const st = SUB_STATUS[s.status]!;
                return (
                  <li key={s.id} className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 font-medium text-ink">
                        {s.name} <Badge tone={st.tone}>{st.label}</Badge>
                      </p>
                      <p className="text-[13px] text-muted">
                        {formatMoney(s.amountCents, s.currency)} every {s.interval === "year" ? "year" : "month"}
                        {s.status === "active" && s.nextBillingAt ? ` · Next payment ${day(s.nextBillingAt)}` : ""}
                        {s.status === "pending" ? " · Charged automatically once you subscribe" : ""}
                      </p>
                    </div>
                    {s.status === "pending" ? <SubscribeButton id={s.id} label={s.name} /> : null}
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 text-[12px] text-muted">To change your payment method, use your PayPal account. To stop a subscription, message us.</p>
          </Card>
        ) : null}

        <Card title="Invoices to pay">
          {open.length ? (
            <ul className="divide-y divide-line">
              {open.map((i) => (
                <li key={i.id} className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-medium text-ink">{i.title}</p>
                    <p className="text-[13px] text-muted">
                      {i.number ? `Invoice #${i.number} · ` : ""}
                      {i.dueDate ? `Due ${formatDate(i.dueDate)}` : "Due on receipt"}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 sm:shrink-0">
                    <span className="text-right">
                      <span className="block text-[16px] font-semibold text-ink tabular">{formatMoney(i.totalCents - i.paidCents, i.currency)}</span>
                      {i.paidCents ? <span className="block text-[12px] text-muted">of {formatMoney(i.totalCents, i.currency)}</span> : null}
                    </span>
                    <a
                      href={i.payUrl!}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-10 items-center justify-center rounded-md bg-brand px-4 text-sm font-medium text-white hover:bg-brand-strong"
                    >
                      Pay now<span className="sr-only"> {i.title} (opens PayPal in a new tab)</span>
                    </a>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={<Receipt />} title="You’re all paid up">
              New invoices from the firm will appear here. You’ll also get each one by email.
            </EmptyState>
          )}
        </Card>

        {past.length ? (
          <Card title="History">
            <ul className="divide-y divide-line">
              {past.map((i) => {
                const s = CLIENT_STATUS[i.status] ?? { label: i.status, tone: "neutral" as const };
                return (
                  <li key={i.id} className="flex items-center justify-between gap-3 py-2.5 text-[14px] first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <p className="truncate text-ink">{i.title}</p>
                      <p className="text-[12px] text-muted">
                        {i.number ? `#${i.number} · ` : ""}
                        {i.paidAt ? `Paid ${formatDate(i.paidAt.toISOString().slice(0, 10))}` : i.sentAt ? `Sent ${formatDate(i.sentAt.toISOString().slice(0, 10))}` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="tabular text-ink">{formatMoney(i.totalCents, i.currency)}</span>
                      <Badge tone={s.tone}>{s.label}</Badge>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>
        ) : null}
        <p className="text-[12px] text-muted">Questions about an invoice? Send us a message from the Messages tab.</p>
      </div>
    </>
  );
}
