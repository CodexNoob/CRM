import type { Metadata } from "next";
import { getDb } from "@/db";
import { PageHeader, StatStrip } from "@/components/ui";
import { requireStaffActor } from "@/lib/auth/current";
import { can } from "@/lib/auth/permissions";
import { listClientOptions } from "@/services/clients";
import { listPortalAccess } from "@/services/portal-access";
import { InviteContactButton, PortalAccessTable } from "./portal-table";

export const metadata: Metadata = { title: "Client Portal" };
export const dynamic = "force-dynamic";

export default async function ClientPortalPage() {
  const actor = await requireStaffActor();
  const db = getDb();
  const canView = can(actor, "client_portal", "view");
  const [rows, clients] = await Promise.all([canView ? listPortalAccess(db, actor) : Promise.resolve([]), listClientOptions(db, actor)]);
  const perms = {
    invite: can(actor, "client_portal", "invite_client"),
    manageAccess: can(actor, "client_portal", "manage_access"),
    suspend: can(actor, "client_portal", "suspend_access"),
  };
  const people = new Set(rows.map((r) => r.userId));
  const activeLogins = new Set(rows.filter((r) => r.isActive && r.hasPassword && r.status === "active").map((r) => r.userId)).size;
  const invited = new Set(rows.filter((r) => r.isActive && !r.hasPassword).map((r) => r.userId)).size;
  const suspended = rows.filter((r) => r.status === "suspended").length;
  const clientOptions = clients.map((c) => ({ id: c.id, name: c.name }));

  return (
    <>
      <PageHeader
        title="Client Portal"
        description="Who can sign in to the client portal, and for which clients. Portal users only ever see their own clients’ records."
        actions={perms.invite ? <InviteContactButton clients={clientOptions} /> : undefined}
      />
      <StatStrip
        className="mb-5"
        items={[
          { label: "People with portal access", value: people.size },
          { label: "Signed up", value: activeLogins, tone: "success" },
          { label: "Invited, not set up", value: invited, tone: invited ? "warning" : "default" },
          { label: "Suspended client access", value: suspended, tone: suspended ? "danger" : "default" },
        ]}
      />
      {canView ? (
        <PortalAccessTable
          rows={rows.map((r) => ({
            key: `${r.userId}:${r.clientId}`,
            userId: r.userId,
            name: r.userName,
            email: r.email,
            isActive: r.isActive,
            hasPassword: r.hasPassword,
            clientId: r.clientId,
            clientName: r.clientName,
            role: r.role,
            status: r.status,
            lastSignIn: r.lastSignIn ? r.lastSignIn.toISOString() : null,
          }))}
          clients={clientOptions}
          perms={perms}
        />
      ) : (
        <p className="text-sm text-muted">You don’t have access to portal management.</p>
      )}
    </>
  );
}
