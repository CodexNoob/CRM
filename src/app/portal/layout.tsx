import { logoutAction } from "@/app/actions/auth";
import { getDb } from "@/db";
import { PortalClientSwitcher, PortalNotificationsBell, PortalTabs, type PortalTab } from "@/components/portal-tabs";
import { requirePortalContext } from "@/lib/auth/portal-context";
import { countUnreadPortalNotifications, listPortalNotifications } from "@/services/client-notifications";
import { countOpenPortalInvoices } from "@/services/invoices";
import { countPortalUnreadMessages } from "@/services/portal";
import { getPublicProfile } from "@/services/settings";

/** E-signatures are shown only once a real provider is configured and enabled. */
const signaturesEnabled = () => process.env.DROPBOX_SIGN_ENABLED === "1" && !!process.env.DROPBOX_SIGN_API_KEY?.trim();

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requirePortalContext();
  const db = getDb();
  const clientId = ctx.client.clientId;
  // Services that authorize by actor.clientId get the server-resolved client.
  const scopedActor = { ...ctx.actor, clientId };
  const [unreadMessages, openInvoices, profile, notifications, unreadNotifications] = await Promise.all([
    countPortalUnreadMessages(db, ctx.actor, clientId),
    countOpenPortalInvoices(db, scopedActor),
    getPublicProfile(db, ctx.actor.firmId),
    listPortalNotifications(db, ctx.actor, clientId, 15),
    countUnreadPortalNotifications(db, ctx.actor, clientId),
  ]);

  const tabs: PortalTab[] = [
    { href: "/portal", label: "Overview" },
    { href: "/portal/services", label: "My Services" },
    { href: "/portal/documents", label: "Documents" },
    { href: "/portal/messages", label: "Messages", count: unreadMessages, countLabel: " unread" },
    ...(signaturesEnabled() ? [{ href: "/portal/signatures", label: "Signature Requests" }] : []),
    { href: "/portal/invoices", label: "Invoices & Billing", count: openInvoices, countLabel: " to pay" },
    { href: "/portal/profile", label: "My Profile" },
  ];

  return (
    <div className="min-h-dvh">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <span className="flex min-w-0 items-center gap-2 font-semibold">
            <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-md bg-brand text-xs font-bold text-white">
              {profile.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "P"}
            </span>
            <span className="truncate">{profile.name}</span>
            <span className="hidden text-sm font-normal text-muted sm:inline">· Client Portal</span>
          </span>
          <div className="ml-auto flex items-center gap-2">
            {ctx.clients.length > 1 ? (
              <PortalClientSwitcher clients={ctx.clients.map((c) => ({ clientId: c.clientId, name: c.name }))} current={clientId} />
            ) : (
              <span className="hidden max-w-[14rem] truncate text-sm text-muted sm:inline">{ctx.client.name}</span>
            )}
            <PortalNotificationsBell
              unread={unreadNotifications}
              items={notifications.map((n) => ({ id: n.id, title: n.title, href: n.href, read: !!n.readAt, createdAt: n.createdAt.toISOString() }))}
            />
            <form action={logoutAction}>
              <button type="submit" className="rounded-md px-3 py-2 text-sm text-brand-ink hover:bg-subtle">
                Sign out
              </button>
            </form>
          </div>
        </div>
        <div className="mx-auto max-w-4xl px-4">
          <PortalTabs tabs={tabs} />
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-6 sm:py-8">{children}</main>
    </div>
  );
}
