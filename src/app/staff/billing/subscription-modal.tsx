"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Check, X } from "lucide-react";
import { logoutAction } from "@/app/actions/auth";
import { cancelPendingFirmCheckoutAction, refreshFirmBillingAction } from "@/app/actions/billing";
import { Alert, Badge } from "@/components/ui";
import { product, PLAN_INTERVALS } from "@/content/product";
import { CancelPendingCheckoutButton, CancelSubscriptionButton, CheckoutButton } from "./billing-controls";

export interface SubscriptionSummary {
  state: "trial" | "active" | "past_due" | "locked";
  locked: boolean;
  trialDaysLeft: number | null;
  reason: string | null;
  canManage: boolean;
  paypalReady: boolean;
  paypalSetupMessage: string | null;
  /** Has an active, past-due, cancelled, or pending PayPal subscription. */
  paying: boolean;
  cancelled: boolean;
  approvalPending: boolean;
  planInterval: "month" | "year" | null;
  planLabel: string | null;
  trialEndsAt: string | null;
  nextBillingAt: string | null;
}

const usd = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: product.currency }).format(cents / 100);
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "—");

/**
 * The firm's subscription, as a modal over the CRM.
 * - Locked (trial over / subscription ended): always open, cannot be closed.
 * - Otherwise opened by `?subscription=1` (trial banner or profile dropdown) and closable.
 */
export function SubscriptionModal({ summary }: { summary: SubscriptionSummary }) {
  const ref = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const requested = params.get("subscription") === "1";
  const returned = params.get("subscribed");
  const open = summary.locked || requested;
  const [refreshing, startRefresh] = useTransition();
  const [checkoutCancelError, setCheckoutCancelError] = useState<string | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  // Return from PayPal: confirm the subscription status with the server.
  useEffect(() => {
    if (returned === "1" && (!summary.paying || summary.approvalPending)) {
      startRefresh(async () => {
        await refreshFirmBillingAction();
        router.refresh();
      });
    }
  }, [returned, summary.paying, summary.approvalPending, router]);

  useEffect(() => {
    if (returned === "0" && summary.approvalPending) {
      startRefresh(async () => {
        const result = await cancelPendingFirmCheckoutAction();
        if (result.status === "error") {
          setCheckoutCancelError(result.message ?? "Contact support to clear the pending PayPal checkout.");
          return;
        }
        router.refresh();
      });
    }
  }, [returned, summary.approvalPending, router]);

  const close = () => {
    if (summary.locked) return;
    const next = new URLSearchParams(params.toString());
    next.delete("subscription");
    next.delete("subscribed");
    const q = next.toString();
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
  };

  return (
    <dialog
      ref={ref}
      aria-labelledby="subscription-title"
      onCancel={(e) => {
        // Escape key: blocked while locked, otherwise close via the URL.
        e.preventDefault();
        close();
      }}
      onClose={() => {
        // Some browsers force-close a dialog after repeated Escape presses; a locked one reopens.
        if (summary.locked) ref.current?.showModal();
      }}
      onClick={(e) => {
        if (e.target === ref.current) close(); // click on the backdrop
      }}
      className="m-auto w-[min(44rem,calc(100vw-2rem))] max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-xl border border-line bg-surface p-0 text-ink shadow-xl backdrop:bg-ink/60 backdrop:backdrop-blur-sm"
    >
      <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
        <div>
          <h2 id="subscription-title" className="text-[17px] font-semibold">
            {summary.locked ? "Subscribe to keep using " + product.name : "Subscription"}
          </h2>
          <p className="mt-0.5 text-[13px] text-muted">Your firm’s plan for {product.name}.</p>
        </div>
        {!summary.locked ? (
          <button type="button" onClick={close} className="-mr-1 inline-flex size-8 items-center justify-center rounded-md text-muted hover:bg-subtle hover:text-ink" aria-label="Close">
            <X className="size-4" />
          </button>
        ) : null}
      </div>

      <div className="space-y-4 px-5 py-4">
        {returned === "1" ? (
          summary.paying && !summary.approvalPending ? (
            <Alert tone="success" title="Thank you — your subscription is active">PayPal confirmed your subscription.</Alert>
          ) : (
            <Alert tone="info">{refreshing ? "Checking PayPal…" : "PayPal is still confirming approval. Refresh shortly."}</Alert>
          )
        ) : returned === "0" ? (
          checkoutCancelError ? (
            <Alert tone="warning" title="PayPal checkout could not be cleared">{checkoutCancelError}</Alert>
          ) : summary.approvalPending ? (
            <Alert tone="info">{refreshing ? "Cancelling the pending PayPal checkout…" : "PayPal checkout was cancelled. No subscription was started."}</Alert>
          ) : (
            <Alert tone="info">PayPal checkout was cancelled. No subscription was started.</Alert>
          )
        ) : null}
        {summary.reason ? <Alert tone={summary.locked ? "error" : "warning"}>{summary.reason}</Alert> : null}

        <dl className="grid gap-3 rounded-lg border border-line bg-hover p-3 text-[13px] sm:grid-cols-3">
          <div>
            <dt className="text-[12px] text-muted">Status</dt>
            <dd className="mt-1">
              {summary.approvalPending ? (
                <Badge tone="info" dot>Awaiting PayPal approval</Badge>
              ) : summary.state === "trial" ? (
                <Badge tone="info" dot>Free trial</Badge>
              ) : summary.state === "active" ? (
                <Badge tone="good" dot>{summary.cancelled ? "Cancelled — access until period end" : "Active"}</Badge>
              ) : summary.state === "past_due" ? (
                <Badge tone="warn" dot>Payment problem</Badge>
              ) : (
                <Badge tone="danger" dot>Locked</Badge>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-[12px] text-muted">{summary.state === "trial" && !summary.approvalPending ? "Trial ends" : "Plan"}</dt>
            <dd className="mt-1 font-medium">
              {summary.state === "trial" && !summary.approvalPending
                ? `${day(summary.trialEndsAt)}${summary.trialDaysLeft ? ` (${summary.trialDaysLeft} days left)` : ""}`
                : summary.planLabel ?? "—"}
            </dd>
          </div>
          <div>
            <dt className="text-[12px] text-muted">{summary.cancelled ? "Access until" : "Next payment"}</dt>
            <dd className="mt-1 font-medium">{day(summary.nextBillingAt)}</dd>
          </div>
        </dl>

        {summary.approvalPending ? (
          <div className="space-y-3">
            {summary.canManage ? (
              <>
                <Alert tone="info">
                  {summary.planInterval
                    ? "A PayPal checkout is waiting for approval. Continue it or cancel it to choose a plan again."
                    : "A PayPal checkout is waiting for approval, but its plan details are missing. Cancel it to choose a plan again."}
                </Alert>
                <div className="flex flex-wrap items-center gap-2">
                  {summary.planInterval ? (
                    <CheckoutButton interval={summary.planInterval} label="Continue with PayPal" primary />
                  ) : null}
                  <CancelPendingCheckoutButton />
                </div>
              </>
            ) : (
              <Alert tone="info">A PayPal checkout is waiting for approval. Ask your firm admin to continue or cancel it.</Alert>
            )}
          </div>
        ) : !summary.paying ? (
          summary.canManage ? (
            <>
              {!summary.paypalReady ? (
                <Alert tone="warning" title="PayPal checkout is not ready">
                  {summary.paypalSetupMessage ?? "Contact support to complete the PayPal API and webhook configuration."}
                </Alert>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2">
                {PLAN_INTERVALS.map((interval) => {
                  const plan = product.plans[interval];
                  const featured = interval === "year";
                  return (
                    <div key={interval} className={"rounded-lg border p-4 " + (featured ? "border-brand" : "border-line")}>
                      <div className="flex items-center justify-between">
                        <h3 className="text-[14px] font-semibold">{plan.label}</h3>
                        {featured ? <Badge tone="brand">2 months free</Badge> : null}
                      </div>
                      <p className="mt-2 text-[26px] font-semibold tracking-tight tabular">
                        {usd(plan.amountCents)}
                        <span className="text-[13px] font-normal text-muted"> / {plan.per}</span>
                      </p>
                      <p className="mb-3 text-[12px] text-muted">{plan.note}</p>
                      <CheckoutButton
                        interval={interval}
                        label={`Subscribe ${plan.label.toLowerCase()}`}
                        primary={featured}
                        disabled={!summary.paypalReady}
                      />
                    </div>
                  );
                })}
              </div>
              <ul className="grid gap-1.5 text-[13px] sm:grid-cols-2">
                {product.included.map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden /> {f}
                  </li>
                ))}
              </ul>
              <p className="text-[12px] text-muted">Payments are processed by PayPal (card or PayPal account). Card details never reach this app. Prices in USD.</p>
            </>
          ) : (
            <Alert tone="info">Only your firm’s admin can subscribe. Please ask them to sign in and choose a plan.</Alert>
          )
        ) : summary.canManage && !summary.cancelled ? (
          <div className="space-y-2 border-t border-line pt-4">
            <p className="text-[13px] text-muted">Cancelling stops future PayPal charges. You keep access until the paid period ends.</p>
            <CancelSubscriptionButton />
          </div>
        ) : null}

        {summary.locked ? (
          <form action={logoutAction} className="border-t border-line pt-3 text-right">
            <button type="submit" className="rounded-md px-2 py-1.5 text-[13px] text-muted hover:bg-subtle hover:text-ink">
              Sign out
            </button>
          </form>
        ) : null}
      </div>
    </dialog>
  );
}
