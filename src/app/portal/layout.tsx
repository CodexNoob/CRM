import { logoutAction } from "@/app/actions/auth";
import { getDb } from "@/db";
import { PortalTabs } from "@/components/portal-tabs";
import { requireClientActor } from "@/lib/auth/current";
import { countOpenPortalInvoices } from "@/services/invoices";
import { countUnreadForClient } from "@/services/messages";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireClientActor();
  const [unread, openInvoices] = await Promise.all([countUnreadForClient(getDb(), actor), countOpenPortalInvoices(getDb(), actor)]);
  return (
    <div className="min-h-dvh">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-3xl items-center gap-4 px-4 py-3">
          <span className="flex items-center gap-2 font-semibold">
            <span aria-hidden className="flex size-7 items-center justify-center rounded-md bg-brand text-xs font-bold text-white">MY</span>
            Client Portal
          </span>
          <span className="ml-auto hidden truncate text-sm text-muted sm:inline">{actor.name}</span>
          <form action={logoutAction} className="ml-auto sm:ml-0">
            <button type="submit" className="rounded-md px-3 py-2 text-sm text-brand-ink hover:bg-subtle">
              Sign out
            </button>
          </form>
        </div>
        <div className="mx-auto max-w-3xl px-4">
          <PortalTabs unread={unread} openInvoices={openInvoices} />
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6 sm:py-8">{children}</main>
    </div>
  );
}
