"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { linkQboCustomerAction, listQboCustomersAction } from "@/app/actions/qbo";
import { Alert, Badge, buttonClass } from "@/components/ui";

type Customer = { id: string; displayName: string; email: string | null };

export function QboCustomerMatch({
  recordId,
  current,
  canManage,
}: {
  recordId: string;
  current: { customerId: string; displayName: string } | null;
  canManage: boolean;
}) {
  const router = useRouter();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedId, setSelectedId] = useState(current?.customerId ?? "");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const [loading, startLoad] = useTransition();

  const load = () => {
    setMessage(null);
    startLoad(async () => {
      const result = await listQboCustomersAction();
      if (result.status === "success") setCustomers(result.customers);
      else setMessage({ ok: false, text: result.message });
    });
  };
  const save = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await linkQboCustomerAction(recordId, selectedId);
      setMessage({ ok: result.status === "success", text: result.message ?? "Could not save this QuickBooks customer match." });
      if (result.status === "success") router.refresh();
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-[13px]">
        <span className="font-medium">QuickBooks customer</span>
        {current ? <Badge tone="good" dot>Matched: {current.displayName}</Badge> : <Badge tone="warn">Not matched</Badge>}
      </div>
      {canManage ? (
        <>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-56 flex-1">
              <label htmlFor={`qbo-customer-${recordId}`} className="mb-1 block text-[12px] font-medium text-ink">Existing QuickBooks customer</label>
              <select
                id={`qbo-customer-${recordId}`}
                value={selectedId}
                onChange={(event) => setSelectedId(event.target.value)}
                className="w-full rounded-md border border-line bg-surface px-3 py-2 text-[13px]"
              >
                <option value="">Choose an existing customer</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>{customer.displayName}{customer.email ? ` · ${customer.email}` : ""}</option>
                ))}
              </select>
            </div>
            <button type="button" className={buttonClass("secondary")} disabled={loading} onClick={load}>{loading ? "Loading…" : "Load customers"}</button>
            <button type="button" className={buttonClass("primary")} disabled={!selectedId || pending} onClick={save}>{pending ? "Saving…" : "Save match"}</button>
          </div>
          <p className="text-[12px] text-muted">The CRM only links an existing QuickBooks customer. It never creates or silently duplicates customers.</p>
        </>
      ) : null}
      {message ? <Alert tone={message.ok ? "success" : "error"}>{message.text}</Alert> : null}
    </div>
  );
}
