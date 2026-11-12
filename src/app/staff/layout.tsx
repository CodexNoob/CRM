import { Suspense } from "react";
import { cookies } from "next/headers";
import { getDb } from "@/db";
import { navForRole } from "@/components/staff/nav-config";
import { StaffShell } from "@/components/staff/shell";
import { product } from "@/content/product";
import { getCurrentFirmAccess, requireStaffActor } from "@/lib/auth/current";
import { ROLE_LABELS } from "@/lib/labels";
import { getBillingOverview } from "@/services/firm-billing";
import { countLeadsByStatus } from "@/services/leads";
import { countUnreadForStaff } from "@/services/messages";
import { getPublicProfile } from "@/services/settings";
import { countMyOpenTasks } from "@/services/tasks";
import { getNotifications } from "@/services/workspace";
import { BillingBanner } from "./billing/billing-banner";
import { SubscriptionModal, type SubscriptionSummary } from "./billing/subscription-modal";

function initials(name: string) {
  const words = name.split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words[0]![0]! + words[1]![0]! : name.slice(0, 2)).toUpperCase();
}

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  // The layout renders for locked firms too (to show the subscription modal); pages enforce the lock.
  const actor = await requireStaffActor({ allowLocked: true });
  const access = await getCurrentFirmAccess(actor.firmId);
  const db = getDb();
  // Admin-only items are hidden here AND refused by their pages and services on the server.
  const sections = navForRole(actor.role === "admin");
  const [myOpenTasks, leadCounts, unreadMessages, notifications, profile, billing, jar] = await Promise.all([
    access.locked ? 0 : countMyOpenTasks(db, actor),
    access.locked ? null : countLeadsByStatus(db, actor),
    access.locked ? 0 : countUnreadForStaff(db, actor),
    access.locked ? [] : getNotifications(db, actor),
    getPublicProfile(db, actor.firmId),
    getBillingOverview(db, actor),
    cookies(),
  ]);

  const { firm } = billing;
  const interval = firm.billingInterval === "month" || firm.billingInterval === "year" ? firm.billingInterval : null;
  const summary: SubscriptionSummary = {
    state: billing.access.state,
    locked: billing.access.locked,
    trialDaysLeft: billing.access.trialDaysLeft,
    reason: billing.access.reason,
    canManage: billing.canManage,
    paypalReady: billing.paypalReady,
    paying: (firm.status === "active" || firm.status === "past_due") && !!firm.paypalSubscriptionId,
    cancelled: firm.status === "cancelled",
    planLabel: interval ? `${product.plans[interval].label} · ${new Intl.NumberFormat("en-US", { style: "currency", currency: product.currency }).format(product.plans[interval].amountCents / 100)}` : null,
    trialEndsAt: firm.trialEndsAt?.toISOString() ?? null,
    nextBillingAt: firm.nextBillingAt?.toISOString() ?? null,
  };

  return (
    <StaffShell
      sections={sections}
      badges={{ myOpenTasks, newLeads: leadCounts?.new ?? 0, unreadMessages }}
      initialCollapsed={jar.get("crm_sidebar")?.value === "collapsed"}
      workspace={{ name: profile.name, initials: initials(profile.name) }}
      user={{ name: actor.name, email: actor.email, roleLabel: ROLE_LABELS[actor.role], isAdmin: actor.role === "admin" }}
      notifications={notifications}
    >
      {access.locked ? null : <BillingBanner access={access} isAdmin={actor.role === "admin"} />}
      {/* While locked, no CRM content renders behind the modal. */}
      {access.locked ? <div aria-hidden className="min-h-[60vh]" /> : children}
      <Suspense fallback={null}>
        <SubscriptionModal summary={summary} />
      </Suspense>
    </StaffShell>
  );
}
