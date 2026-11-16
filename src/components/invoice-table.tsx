import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { InvoiceRowActions } from "@/components/invoice-client";
import { SimpleTable, td, tdHide } from "@/components/table";
import { Badge } from "@/components/ui";
import type { InvoiceListRow } from "@/services/invoices";
import { formatDate, formatMoney, INVOICE_STATUS_LABELS } from "@/lib/labels";
import { dueLabel, INVOICE_TONE } from "@/lib/status";

/** Staff invoice table (used on /staff/invoices and the client Invoices tab). */
export function InvoiceTable({ rows, showClient, canCancel, today, firmId }: { rows: InvoiceListRow[]; showClient: boolean; canCancel: boolean; today: string; firmId?: string }) {
  return (
    <SimpleTable
      label="Invoices"
      headers={[
        { label: "Invoice" },
        ...(showClient ? [{ label: "Client" }] : []),
        { label: "Amount", align: "right" as const },
        { label: "Due", hideBelow: "md" as const },
        { label: "Status" },
        { label: "Actions", align: "right" as const },
      ]}
    >
      {rows.map((r) => {
        const open = r.status === "sent" || r.status === "partially_paid";
        const due = open ? dueLabel(r.dueDate, today) : null;
        return (
          <tr key={r.id}>
            <td className={td}>
              <div className="font-medium text-ink">{r.title}</div>
              <div className="text-[12px] text-muted">
                {r.number ? `#${r.number} · ` : ""}
                {r.sentAt ? `Sent ${formatDate(r.sentAt.toISOString().slice(0, 10))}` : "Not sent"}
                {r.payUrl && open ? (
                  <>
                    {" · "}
                    <a href={r.payUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 hover:text-brand hover:underline">
                      Payment page <ExternalLink className="size-3" aria-hidden />
                      <span className="sr-only">(opens QuickBooks in a new tab)</span>
                    </a>
                  </>
                ) : null}
              </div>
            </td>
            {showClient ? (
              <td className={td}>
                <Link href={`/staff/clients/${r.clientId}?tab=billing${firmId ? `&firmId=${encodeURIComponent(firmId)}` : ""}`} className="hover:text-brand hover:underline">
                  {r.clientName}
                </Link>
              </td>
            ) : null}
            <td className={`${td} text-right tabular`}>
              <div className="font-medium text-ink">{formatMoney(r.totalCents, r.currency)}</div>
              {r.status === "partially_paid" ? <div className="text-[12px] text-muted">{formatMoney(r.paidCents, r.currency)} paid</div> : null}
            </td>
            <td className={`${td} ${tdHide.md} whitespace-nowrap`}>
              {r.dueDate ? formatDate(r.dueDate) : <span className="text-muted">On receipt</span>}
              {due && r.dueDate ? (
                <div className="mt-0.5">
                  <Badge tone={due.tone}>{due.text}</Badge>
                </div>
              ) : null}
            </td>
            <td className={td}>
              <Badge tone={INVOICE_TONE[r.status]} dot>
                {INVOICE_STATUS_LABELS[r.status]}
              </Badge>
            </td>
            <td className={`${td} text-right`}>
              <InvoiceRowActions id={r.id} clientId={r.clientId} status={r.status} canCancel={canCancel} firmId={firmId} />
            </td>
          </tr>
        );
      })}
    </SimpleTable>
  );
}
