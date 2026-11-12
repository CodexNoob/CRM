import Link from "next/link";
import type { FirmAccess } from "@/services/firm-billing";

/** Thin notice above every staff page: trial days left, payment problems, or the lock. */
export function BillingBanner({ access, isAdmin }: { access: FirmAccess; isAdmin: boolean }) {
  if (access.state === "active") return null;
  const tone =
    access.state === "trial" && (access.trialDaysLeft ?? 99) > 3
      ? "border-info/30 bg-info-soft text-ink"
      : access.state === "locked"
        ? "border-danger/30 bg-danger-soft text-danger-ink"
        : "border-warning/40 bg-warning-soft text-warning-ink";
  const text =
    access.state === "trial"
      ? access.trialDaysLeft === null
        ? "You’re on a free trial."
        : `Free trial: ${access.trialDaysLeft} ${access.trialDaysLeft === 1 ? "day" : "days"} left.`
      : access.reason;
  return (
    <div role="status" className={`mb-4 flex flex-col gap-2 rounded-md border px-3 py-2 text-[13px] sm:flex-row sm:items-center sm:justify-between ${tone}`}>
      <span>{text}</span>
      {isAdmin ? (
        <Link href="?subscription=1" scroll={false} className="font-medium underline underline-offset-2">
          {access.state === "past_due" ? "View subscription" : "Subscribe now"}
        </Link>
      ) : (
        <span className="text-[12px]">Ask your firm admin to subscribe.</span>
      )}
    </div>
  );
}
