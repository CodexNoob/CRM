"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { Bell } from "lucide-react";
import { markPortalNotificationsReadAction, switchPortalClientAction } from "@/app/actions/portal";
import { idleState } from "@/lib/action-state";

export interface PortalTab {
  href: string;
  label: string;
  count?: number;
  countLabel?: string;
}

/** Client-facing navigation. The tab list is built on the server (only implemented, authorized modules). */
export function PortalTabs({ tabs }: { tabs: PortalTab[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Portal" className="-mb-px flex gap-1 overflow-x-auto">
      {tabs.map((t) => {
        const active = t.href === "/portal" ? pathname === "/portal" : pathname === t.href || pathname.startsWith(`${t.href}/`);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={
              "flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium " +
              (active ? "border-brand text-brand-ink" : "border-transparent text-muted hover:text-ink")
            }
          >
            {t.label}
            {t.count ? (
              <span className="rounded-full bg-brand px-1.5 py-0.5 text-[11px] leading-none text-white tabular-nums">
                {t.count}
                <span className="sr-only">{t.countLabel ?? ""}</span>
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

/** Switch between the client accounts this person may access (validated on the server). */
export function PortalClientSwitcher({ clients, current }: { clients: { clientId: string; name: string }[]; current: string }) {
  const [state, action] = useActionState(switchPortalClientAction, idleState);
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.status === "success") router.refresh();
  }, [state, router]);
  if (clients.length < 2) return null;
  return (
    <form ref={formRef} action={action} className="flex items-center gap-2">
      <label htmlFor="portal-client" className="sr-only">
        Account
      </label>
      <select
        id="portal-client"
        name="clientId"
        defaultValue={current}
        onChange={() => formRef.current?.requestSubmit()}
        className="h-9 max-w-56 truncate rounded-md border border-line bg-surface px-2 text-sm text-ink"
      >
        {clients.map((c) => (
          <option key={c.clientId} value={c.clientId}>
            {c.name}
          </option>
        ))}
      </select>
      <noscript>
        <button type="submit" className="rounded-md border border-line px-2 py-1 text-sm">
          Switch
        </button>
      </noscript>
      {state.status === "error" ? (
        <span role="alert" className="text-xs text-danger-ink">
          {state.message}
        </span>
      ) : null}
    </form>
  );
}

export interface PortalNotificationView {
  id: string;
  title: string;
  href: string | null;
  read: boolean;
  createdAt: string;
}

const when = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** In-portal notifications (these are not emails). */
export function PortalNotificationsBell({ items, unread }: { items: PortalNotificationView[]; unread: number }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        className="relative inline-flex size-9 items-center justify-center rounded-md text-muted hover:bg-subtle hover:text-ink"
      >
        <Bell className="size-4" aria-hidden />
        {unread ? <span className="absolute right-1 top-1 min-w-4 rounded-full bg-brand px-1 text-[10px] leading-4 text-white tabular-nums">{unread}</span> : null}
      </button>
      {open ? (
        <div className="absolute right-0 z-40 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-line bg-surface shadow-lg">
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <span className="text-sm font-semibold">Notifications</span>
            {unread ? (
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    await markPortalNotificationsReadAction();
                    router.refresh();
                  })
                }
                className="text-xs font-medium text-brand-ink hover:underline"
              >
                Mark all read
              </button>
            ) : null}
          </div>
          {items.length ? (
            <ul className="max-h-80 divide-y divide-line overflow-y-auto">
              {items.map((n) => (
                <li key={n.id} className={n.read ? "" : "bg-brand-soft/40"}>
                  {n.href ? (
                    <Link href={n.href} onClick={() => setOpen(false)} className="block px-3 py-2 text-sm hover:bg-subtle">
                      <span className="block text-ink">{n.title}</span>
                      <span className="text-xs text-muted">{when.format(new Date(n.createdAt))}</span>
                    </Link>
                  ) : (
                    <div className="px-3 py-2 text-sm">
                      <span className="block text-ink">{n.title}</span>
                      <span className="text-xs text-muted">{when.format(new Date(n.createdAt))}</span>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-3 py-6 text-center text-sm text-muted">You’re all caught up.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
