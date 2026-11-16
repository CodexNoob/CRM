"use client";

import { useActionState, useState, useTransition } from "react";
import {
  connectQboAction,
  disconnectQboAction,
  listQboItemsAction,
  setQboDefaultItemAction,
  verifyQboAction,
} from "@/app/actions/qbo";
import { SubmitButton } from "@/components/form";
import { Alert, Badge, buttonClass } from "@/components/ui";
import { idleState, type ActionState } from "@/lib/action-state";
import type { QboConnectionView } from "@/services/qbo-connections";

export function QboConnectionControls({
  view,
  canManage,
  environment,
  financialActionsEnabled,
}: {
  view: QboConnectionView;
  canManage: boolean;
  environment: "sandbox" | "production";
  financialActionsEnabled: boolean;
}) {
  const [connectState, connectAction] = useActionState(connectQboAction, idleState);
  const [verifyState, verifyAction] = useActionState(verifyQboAction, idleState);
  const [disconnectState, disconnectAction] = useActionState(disconnectQboAction, idleState);
  const [items, setItems] = useState<{ id: string; name: string }[]>([]);
  const [itemId, setItemId] = useState(view.defaultItemId ?? "");
  const [itemState, setItemState] = useState<ActionState | null>(null);
  const [loadingItems, startLoadItems] = useTransition();
  const [savingItem, startSaveItem] = useTransition();

  const loadItems = () => {
    startLoadItems(async () => {
      const result = await listQboItemsAction();
      if (result.status === "success") setItems(result.items);
      else setItemState({ status: "error", message: result.message });
    });
  };
  const saveItem = () => {
    startSaveItem(async () => {
      const result = await setQboDefaultItemAction(itemId);
      setItemState(result);
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={view.status === "connected" ? "good" : view.status === "reauthorization_required" || view.status === "expired" ? "warn" : "neutral"} dot>
          {view.status === "connected" ? "Connected" : view.status === "reauthorization_required" ? "Reconnect required" : view.status === "expired" ? "Authorization expired" : "Not connected"}
        </Badge>
        <Badge tone={environment === "sandbox" ? "info" : "warn"}>{environment === "sandbox" ? "Sandbox" : "Production"}</Badge>
        {view.companyName ? <span className="text-[13px] text-muted">{view.companyName}</span> : null}
      </div>
      {view.status === "reauthorization_required" || view.status === "expired" ? (
        <Alert tone="warning">QuickBooks access was revoked or expired. Reconnect this company before using billing.</Alert>
      ) : null}
      {canManage ? (
        <div className="flex flex-wrap gap-2">
          <form action={connectAction}>
            <SubmitButton pendingText="Opening QuickBooks…" variant={view.connected ? "secondary" : "primary"}>
              {view.connected ? "Reconnect company" : "Connect company"}
            </SubmitButton>
            {connectState.status === "error" ? <p role="alert" className="mt-1 text-[12px] text-danger-ink">{connectState.fieldErrors?._form?.join(" ") ?? connectState.message}</p> : null}
          </form>
          {view.connected ? (
            <>
              <form action={verifyAction}>
                <SubmitButton pendingText="Verifying…" variant="secondary">Verify connection</SubmitButton>
                {verifyState.status === "success" ? <p className="mt-1 text-[12px] text-success">{verifyState.message}</p> : null}
                {verifyState.status === "error" ? <p role="alert" className="mt-1 text-[12px] text-danger-ink">{verifyState.fieldErrors?._form?.join(" ") ?? verifyState.message}</p> : null}
              </form>
                  <form action={disconnectAction} onSubmit={(event) => {
                    if (!window.confirm("Disconnect this QuickBooks company? Billing actions will stop until an administrator reconnects it.")) event.preventDefault();
                  }}>
                <SubmitButton pendingText="Disconnecting…" variant="ghost" className="text-danger-ink">Disconnect</SubmitButton>
                {disconnectState.status === "success" ? <p className="mt-1 text-[12px] text-success">{disconnectState.message}</p> : null}
                {disconnectState.status === "error" ? <p role="alert" className="mt-1 text-[12px] text-danger-ink">{disconnectState.fieldErrors?._form?.join(" ") ?? disconnectState.message}</p> : null}
              </form>
            </>
          ) : null}
        </div>
      ) : null}
      {view.connected && canManage ? (
        <div className="space-y-2 border-t border-line pt-3">
          <p className="text-[12px] text-muted">Choose the active QuickBooks service item used for CRM invoice lines. The CRM will not create customers or items automatically.</p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-56 flex-1">
              <label htmlFor="qbo-item" className="mb-1 block text-[12px] font-medium text-ink">Invoice service item</label>
              <select id="qbo-item" value={itemId} onChange={(event) => setItemId(event.target.value)} className="w-full rounded-md border border-line bg-surface px-3 py-2 text-[13px]">
                <option value="">Choose a service item</option>
                {items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </div>
            <button type="button" className={buttonClass("secondary")} disabled={loadingItems} onClick={loadItems}>{loadingItems ? "Loading…" : "Load items"}</button>
            <button type="button" className={buttonClass("primary")} disabled={!itemId || savingItem} onClick={saveItem}>{savingItem ? "Saving…" : "Save item"}</button>
          </div>
          {itemState?.status === "success" ? <p className="text-[12px] text-success">{itemState.message}</p> : null}
          {itemState?.status === "error" ? <p role="alert" className="text-[12px] text-danger-ink">{itemState.fieldErrors?._form?.join(" ") ?? itemState.message}</p> : null}
          <p className="text-[12px] text-muted">
            Financial actions: {financialActionsEnabled && view.verified && view.defaultItemId ? "enabled by deployment settings" : "disabled until the sandbox invoice/payment workflow is verified and enabled"}.
          </p>
        </div>
      ) : null}
    </div>
  );
}
