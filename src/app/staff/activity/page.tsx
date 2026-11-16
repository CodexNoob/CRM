import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { PageHeader } from "@/components/ui";
import { requireStaffActor } from "@/lib/auth/current";
import { listRecentActivity } from "@/services/audit";
import { listPlatformFirms, resolveFirmContext } from "@/services/firms";
import { FirmScopePicker } from "@/components/staff/firm-scope-picker";
import { ActivityTable } from "./activity-table";

export const metadata: Metadata = { title: "Activity Logs" };

const ACTION_LABELS: Record<string, string> = {
  "auth.login": "Signed in",
  "auth.login_failed": "Failed sign-in attempt",
  "auth.account_locked": "Account locked after failed attempts",
  "auth.login_blocked_locked": "Sign-in blocked (account locked)",
  "auth.password_set": "Set a password",
  "client.create": "Created a client",
  "client.update": "Updated a client",
  "engagement.create": "Created an engagement",
  "engagement.update": "Updated an engagement",
  "task.create": "Added a task",
  "task.complete": "Completed a task",
  "task.reopen": "Reopened a task",
  "portal.invite": "Created a portal invitation",
  "staff.invite": "Invited a staff member",
  "staff.signin_link": "Issued a staff sign-in link",
  "staff.deactivate": "Deactivated a staff account",
  "staff.reactivate": "Reactivated a staff account",
  "staff.role_change": "Changed a staff role",
  "setup.first_admin": "Created the first admin account",
  "setup.remove_sample_admin": "Removed the sample admin account",
  "lead.create": "Added a lead",
  "lead.update": "Updated a lead",
  "lead.convert": "Converted a lead to a client",
  "lead.website_inquiry": "Website inquiry received",
  "document.upload": "Uploaded a document",
  "document.download": "Downloaded a document",
  "document.share": "Shared a document with a client",
  "document.unshare": "Unshared a document",
  "document.archive": "Archived a document",
  "document.rejected_malware": "Blocked an unsafe upload",
  "message.send": "Sent a message",
  "appointment.create": "Scheduled an appointment",
  "appointment.cancel": "Cancelled an appointment",
  "invoice.create": "Created an invoice in PayPal",
  "invoice.send": "Sent an invoice to a client",
  "invoice.paid": "Invoice paid (confirmed by PayPal)",
  "invoice.cancel": "Cancelled an invoice",
  "subscription.create": "Set up a subscription plan in PayPal",
  "subscription.checkout": "Client started subscribing in PayPal",
  "subscription.activate": "Subscription became active (confirmed by PayPal)",
  "subscription.cancel": "Cancelled a subscription",
  "settings.firm_profile": "Updated the firm profile",
  "settings.announcement_create": "Published an announcement",
  "settings.announcement_publish": "Showed an announcement",
  "settings.announcement_unpublish": "Hid an announcement",
};

function entityHref(type: string, id: string | null) {
  if (!id) return null;
  if (type === "client") return `/staff/clients/${id}`;
  if (type === "engagement") return `/staff/engagements/${id}`;
  if (type === "lead") return `/staff/leads/${id}`;
  return null;
}

export default async function ActivityPage({ searchParams }: { searchParams: Promise<{ firmId?: string }> }) {
  const actor = await requireStaffActor();
  if (actor.role !== "admin" && actor.role !== "super_admin") notFound();
  const db = getDb();
  const params = await searchParams;
  const scope = await resolveFirmContext(db, actor, params.firmId);
  const firms = actor.role === "super_admin" ? await listPlatformFirms(db, actor) : [];
  const rows = await listRecentActivity(db, scope, { limit: 500 });
  return (
    <>
      <PageHeader title="Activity Logs" description="The audit trail: the latest 500 events. Entries cannot be edited or deleted from the application." />
      {actor.role === "super_admin" ? <FirmScopePicker action="/staff/activity" currentFirmId={scope.firmId} firms={firms} /> : null}
      <ActivityTable
        rows={rows.map((r) => ({
          id: r.id,
          action: r.action,
          label: ACTION_LABELS[r.action] ?? r.action,
          entityType: r.entityType,
          href: entityHref(r.entityType, r.entityId),
          actorName: r.actorName,
          createdAt: r.createdAt.toISOString(),
        }))}
      />
    </>
  );
}
