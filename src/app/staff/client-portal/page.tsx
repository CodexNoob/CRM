import type { Metadata } from "next";
import { getDb } from "@/db";
import { PageHeader, StatStrip } from "@/components/ui";
import { requireStaffActor } from "@/lib/auth/current";
import { listPortalAccounts } from "@/services/practice";
import { PortalTable } from "./portal-table";

export const metadata: Metadata = { title: "Client Portal" };

export default async function ClientPortalPage() {
  const actor = await requireStaffActor();
  const accounts = await listPortalAccounts(getDb(), actor);
  const active = accounts.filter((a) => a.isActive && a.hasPassword).length;
  const invited = accounts.filter((a) => a.isActive && !a.hasPassword).length;
  const unread = accounts.reduce((n, a) => n + a.unreadFromClient, 0);

  return (
    <>
      <PageHeader title="Client Portal" description="Portal access, adoption and where clients are waiting on the firm." />
      <StatStrip
        className="mb-5"
        items={[
          { label: "Active logins", value: active, tone: "success" },
          { label: "Invited, not set up", value: invited, tone: invited ? "warning" : "default" },
          { label: "Deactivated", value: accounts.length - active - invited },
          { label: "Unread client messages", value: unread, href: "/staff/messages" },
        ]}
      />
      <PortalTable rows={accounts.map((a) => ({ ...a, lastSignIn: a.lastSignIn ? new Date(a.lastSignIn).toISOString() : null }))} />
    </>
  );
}
