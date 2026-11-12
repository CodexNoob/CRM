"use client";

import { useEffect, useRef, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Check, X } from "lucide-react";
import { logoutAction } from "@/app/actions/auth";
import { refreshFirmBillingAction } from "@/app/actions/billing";
import { Alert, Badge } from "@/components/ui";
import { product, PLAN_INTERVALS } from "@/content/product";
import { CancelSubscriptionButton, CheckoutButton } from "./billing-controls";

export interface SubscriptionSummary {
  state: "trial" | "active" | "past_due" | "locked";
  locked: boolean;
  trialDaysLeft: number | null;
  reason: string | null;
  canManage: boolean;
  paypalReady: boolean;
  /** Has a PayPal subscription that is active or retrying. */
  paying: boolean;
  cancelled: boolean;
  planLabel: string | null;
  trialEndsAt: string | null;
  nextBillingAt: string | null;
}

const usd = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: product.currency }).format(cents / 100);
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "—");

/**
 * The firm's subscription, as a modal over the CRM.
 * - Locked (trial over / subscription ended): always open, cannot be closed.
 * - Otherwise opened by `?subscription=1` (trial banner, profile dropdown, PayPal return) and closable.
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

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  // Back from PayPal: confirm the new status straight away instead of waiting for the next sync.
  useEffect(() => {
    if (returned === "1" && !summary.paying) {
      startRefresh(async () => {
        await refreshFirmBillingAction();
        router.refresh();
      });
    }
  }, [returned, summary.paying, router]);

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
          summary.paying ? (
            <Alert tone="success" title="Thank you — you’re subscribed">Your subscription is active. A receipt is on its way from PayPal.</Alert>
          ) : (
            <Alert tone="info">{refreshing ? "Checking with PayPal…" : "PayPal is confirming your subscription. This usually takes under a minute."}</Alert>
          )
        ) : returned === "0" ? (
          <Alert tone="info">You left PayPal before finishing. Nothing was charged.</Alert>
        ) : null}
        {summary.reason ? <Alert tone={summary.locked ? "error" : "warning"}>{summary.reason}</Alert> : null}

        <dl className="grid gap-3 rounded-lg border border-line bg-hover p-3 text-[13px] sm:grid-cols-3">
          <div>
            <dt className="text-[12px] text-muted">Status</dt>
            <dd className="mt-1">
              {summary.state === "trial" ? (
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
            <dt className="text-[12px] text-muted">{summary.state === "trial" ? "Trial ends" : "Plan"}</dt>
            <dd className="mt-1 font-medium">
              {summary.state === "trial" ? `${day(summary.trialEndsAt)}${summary.trialDaysLeft ? ` (${summary.trialDaysLeft} days left)` : ""}` : (summary.planLabel ?? "—")}
            </dd>
          </div>
          <div>
            <dt className="text-[12px] text-muted">{summary.cancelled ? "Access until" : "Next payment"}</dt>
            <dd className="mt-1 font-medium">{day(summary.nextBillingAt)}</dd>
          </div>
        </dl>

        {!summary.paying ? (
          summary.canManage ? (
            summary.paypalReady ? (
              <>
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
                        <CheckoutButton interval={interval} label={`Subscribe ${plan.label.toLowerCase()}`} primary={featured} />
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
              <Alert tone="warning">Online payment isn’t available yet. Please contact support to subscribe.</Alert>
            )
          ) : (
            <Alert tone="info">Only your firm’s admin can subscribe. Please ask them to sign in and choose a plan.</Alert>
          )
        ) : summary.canManage && !summary.cancelled ? (
          <div className="space-y-2 border-t border-line pt-4">
            <p className="text-[13px] text-muted">To change your card, use your PayPal account. Cancelling stops future payments; you keep access until the period you’ve paid for ends.</p>
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
