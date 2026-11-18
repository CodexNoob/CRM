import Link from "next/link";
import { SubscriptionRowActions } from "@/components/invoice-client";
import { SimpleTable, td, tdHide } from "@/components/table";
import { Badge, type Tone } from "@/components/ui";
import { formatDate, formatMoney } from "@/lib/labels";
import type { SubscriptionRow } from "@/services/subscriptions";

export const SUBSCRIPTION_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: "Setup pending", tone: "warn" },
  active: { label: "Active", tone: "good" },
  suspended: { label: "Billing needs attention", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  expired: { label: "Ended", tone: "neutral" },
};

const day = (d: Date | null) => (d ? formatDate(d.toISOString().slice(0, 10)) : "—");

export function SubscriptionTable({ rows, showClient, canCancel, firmId }: { rows: SubscriptionRow[]; showClient: boolean; canCancel: boolean; firmId?: string }) {
  return (
    <SimpleTable
      label="Subscriptions"
      headers={[
        { label: "Plan" },
        ...(showClient ? [{ label: "Client" }] : []),
        { label: "Amount", align: "right" as const },
        { label: "Next invoice", hideBelow: "md" as const },
        { label: "Status" },
        { label: "Actions", align: "right" as const },
      ]}
    >
      {rows.map((r) => {
        const s = SUBSCRIPTION_STATUS[r.status]!;
        return (
          <tr key={r.id}>
            <td className={td}>
              <div className="font-medium text-ink">{r.name}</div>
              <div className="text-[12px] text-muted">{r.lastPaymentAt ? `Last paid ${day(r.lastPaymentAt)}` : `Started ${day(r.createdAt)}`}</div>
            </td>
            {showClient ? (
              <td className={td}>
                <Link href={`/crm/clients/${r.clientId}?tab=billing${firmId ? `&firmId=${encodeURIComponent(firmId)}` : ""}`} className="hover:text-brand hover:underline">
                  {r.clientName}
                </Link>
              </td>
            ) : null}
            <td className={`${td} whitespace-nowrap text-right tabular`}>
              <span className="font-medium text-ink">{formatMoney(r.amountCents, r.currency)}</span>
              <span className="text-muted"> / {r.interval === "year" ? "yr" : "mo"}</span>
            </td>
            <td className={`${td} ${tdHide.md} whitespace-nowrap`}>{r.status === "active" ? day(r.nextBillingAt) : "—"}</td>
            <td className={td}>
              <Badge tone={s.tone} dot>
                {s.label}
              </Badge>
            </td>
            <td className={`${td} text-right`}>
              <SubscriptionRowActions id={r.id} clientId={r.clientId} status={r.status} canCancel={canCancel} firmId={firmId} />
            </td>
          </tr>
        );
      })}
    </SimpleTable>
  );
}
