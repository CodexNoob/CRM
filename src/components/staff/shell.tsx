"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Bell,
  CalendarPlus,
  ChevronDown,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  CreditCard,
  Funnel,
  LogOut,
  Menu as MenuIcon,
  Plus,
  Search,
  Settings,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { logoutAction } from "@/app/actions/auth";
import { Menu } from "@/components/menu";
import { Avatar, cx } from "@/components/ui";
import { NavIcon } from "./icons";
import type { NavSection } from "./nav-config";

export interface ShellProps {
  sections: NavSection[];
  badges: Record<string, number>;
  initialCollapsed: boolean;
  workspace: { name: string; initials: string; logoDataUrl?: string | null };
  user: { name: string; email: string; roleLabel: string; isAdmin: boolean };
  notifications: { id: string; label: string; detail: string; count: number; href: string; tone: "danger" | "warn" | "info" }[];
  children: ReactNode;
}

const DETAIL_LABELS: Record<string, string> = {
  clients: "Client",
  engagements: "Engagement",
  leads: "Lead",
  messages: "Conversation",
};

function isActive(pathname: string, href: string) {
  return href === "/staff" ? pathname === "/staff" : pathname === href || pathname.startsWith(`${href}/`);
}

/** Breadcrumbs derived from the route and the navigation map. */
function Breadcrumbs({ sections }: { sections: NavSection[] }) {
  const pathname = usePathname();
  const parts = pathname.split("/").filter(Boolean).slice(1);
  const all = sections.flatMap((s) => s.items.map((i) => ({ ...i, section: s.title })));
  const top = all.find((i) => i.href !== "/staff" && (pathname === i.href || pathname.startsWith(`${i.href}/`))) ?? all.find((i) => i.href === "/staff");
  const crumbs: { label: string; href?: string }[] = [];
  if (top) {
    crumbs.push({ label: top.section });
    crumbs.push({ label: top.label, href: parts.length > 1 ? top.href : undefined });
  }
  if (parts.length > 1) {
    const last = parts.at(-1)!;
    if (last === "new") crumbs.push({ label: parts.includes("engagements") && parts[0] === "clients" ? "New engagement" : "New" });
    else if (last === "edit") crumbs.push({ label: "Edit" });
    else crumbs.push({ label: DETAIL_LABELS[parts[0]!] ?? "Details" });
  }
  return (
    <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center text-[13px] md:flex">
      <ol className="flex min-w-0 items-center gap-1.5">
        {crumbs.map((c, i) => (
          <li key={i} className="flex min-w-0 items-center gap-1.5">
            {i > 0 ? <ChevronRight className="size-3.5 shrink-0 text-faint" aria-hidden /> : null}
            {c.href ? (
              <Link href={c.href} className="truncate text-muted hover:text-ink">
                {c.label}
              </Link>
            ) : (
              <span className={cx("truncate", i === crumbs.length - 1 ? "font-medium text-ink" : "text-muted")} aria-current={i === crumbs.length - 1 ? "page" : undefined}>
                {c.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

function SidebarNav({ sections, badges, collapsed, onNavigate }: { sections: NavSection[]; badges: Record<string, number>; collapsed: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <div className="space-y-4">
      {sections.map((section) => (
        <div key={section.title}>
          {collapsed ? <div className="mx-3 mb-1 border-t border-white/10" aria-hidden /> : <p className="px-3 pb-1 text-[11px] font-medium uppercase tracking-[0.06em] text-white/45">{section.title}</p>}
          <ul className="space-y-px">
            {section.items.map((item) => {
              const active = isActive(pathname, item.href);
              const count = item.badge ? (badges[item.badge] ?? 0) : 0;
              return (
                <li key={item.slug}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    title={collapsed ? item.label : undefined}
                    className={cx(
                      "group relative flex h-8 items-center gap-2.5 rounded-md text-[13px] transition-colors",
                      collapsed ? "justify-center px-0" : "px-3",
                      active ? "bg-white/10 font-medium text-white" : "text-white/70 hover:bg-white/5 hover:text-white",
                    )}
                  >
                    {active ? <span aria-hidden className="absolute -left-2 top-1.5 h-5 w-0.5 rounded-r bg-white" /> : null}
                    <NavIcon name={item.icon} className={cx("size-4 shrink-0", item.status === "planned" && !active && "opacity-60")} />
                    {collapsed ? (
                      <span className="sr-only">{item.label}</span>
                    ) : (
                      <>
                        <span className={cx("min-w-0 flex-1 truncate", item.status === "planned" && !active && "text-white/50")}>{item.label}</span>
                        {count > 0 ? (
                          <span className="tabular rounded bg-white/15 px-1.5 text-[11px] font-medium leading-5 text-white">
                            {count > 99 ? "99+" : count}
                            <span className="sr-only">{item.badge === "newLeads" ? " new" : item.badge === "unreadMessages" ? " unread" : " open"}</span>
                          </span>
                        ) : null}
                        {item.status === "planned" ? <span className="text-[10px] font-medium uppercase tracking-wide text-white/35">Soon</span> : null}
                      </>
                    )}
                    {collapsed && count > 0 ? <span aria-hidden className="absolute right-2 top-1.5 size-1.5 rounded-full bg-warning" /> : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** Firm name and mark at the top of the sidebar. Links home; no menu. */
function WorkspaceBrand({ workspace }: { workspace: ShellProps["workspace"] }) {
  return (
    <Link href="/staff" className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-1 py-1.5 text-white hover:bg-white/5">
      {workspace.logoDataUrl ? (
        <Image src={workspace.logoDataUrl} alt="" width={28} height={28} unoptimized className="size-7 shrink-0 rounded-md bg-white object-contain" />
      ) : (
        <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-md bg-white text-[11px] font-bold text-brand">
          {workspace.initials}
        </span>
      )}
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-semibold leading-tight">{workspace.name}</span>
        <span className="block text-[11px] leading-tight text-white/50">Organization workspace</span>
      </span>
    </Link>
  );
}

function UserMenu({ user, compact }: { user: ShellProps["user"]; compact?: boolean }) {
  const formRef = useRef<HTMLFormElement>(null);
  // Opens the subscription modal over whatever page is showing.
  const pathname = usePathname();
  return (
    <>
      <form ref={formRef} action={logoutAction} className="hidden" />
      <Menu
        label={`Account menu for ${user.name}`}
        width="w-64"
        triggerClassName={cx("flex items-center gap-2 rounded-md text-left hover:bg-subtle", compact ? "p-1" : "py-1 pl-1 pr-2")}
        trigger={
          <>
            <Avatar name={user.name} />
            {compact ? null : (
              <span className="hidden min-w-0 lg:block">
                <span className="block max-w-36 truncate text-[13px] font-medium leading-tight text-ink">{user.name}</span>
                <span className="block max-w-36 truncate text-[11.5px] leading-tight text-muted">{user.roleLabel}</span>
              </span>
            )}
            <ChevronDown className="hidden size-3.5 text-muted lg:block" aria-hidden />
          </>
        }
        items={[
          { type: "label", label: user.email },
          { label: "Dashboard", href: "/staff" },
          ...(user.isAdmin
            ? [
                { label: "Subscription", icon: <CreditCard />, href: `${pathname}?subscription=1` },
                { label: "Settings", icon: <Settings />, href: "/staff/settings" },
              ]
            : []),
          { type: "separator" },
          { label: "Sign out", icon: <LogOut />, danger: true, onSelect: () => formRef.current?.requestSubmit() },
        ]}
      />
    </>
  );
}

function GlobalSearch() {
  const router = useRouter();
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest("input,textarea,select,[contenteditable=true]");
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        const q = ref.current?.value.trim();
        if (q) router.push(`/staff/search?q=${encodeURIComponent(q)}`);
      }}
      className="relative w-full max-w-sm"
    >
      <label htmlFor="global-search" className="sr-only">
        Search clients, engagements, leads and documents
      </label>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint" aria-hidden />
      <input
        ref={ref}
        id="global-search"
        type="search"
        maxLength={100}
        placeholder="Search workspace…"
        className="h-8 w-full rounded-md border border-line bg-hover pl-8 pr-12 text-[13px] placeholder:text-faint hover:border-line-strong focus:border-brand focus:bg-surface focus:outline-none focus:ring-2 focus:ring-brand/15"
      />
      <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border border-line bg-surface px-1.5 text-[10.5px] font-medium text-faint sm:block">Ctrl K</kbd>
    </form>
  );
}

function Notifications({ items }: { items: ShellProps["notifications"] }) {
  const total = items.reduce((n, i) => n + i.count, 0);
  const dot = { danger: "bg-danger", warn: "bg-warning", info: "bg-info" };
  return (
    <Menu
      label={total ? `Notifications, ${total} items need attention` : "Notifications"}
      width="w-80"
      triggerClassName="relative inline-flex size-8 items-center justify-center rounded-md text-muted hover:bg-subtle hover:text-ink"
      trigger={
        <>
          <Bell className="size-4" aria-hidden />
          {total ? <span aria-hidden className="absolute right-1.5 top-1.5 size-2 rounded-full border-2 border-surface bg-danger" /> : null}
        </>
      }
      items={
        items.length
          ? [
              { type: "label", label: "Needs attention" },
              ...items.map((i) => ({
                label: `${i.label} (${i.count})`,
                href: i.href,
                icon: <span aria-hidden className={cx("ml-1 mr-1 size-2 rounded-full", dot[i.tone])} />,
              })),
            ]
          : [{ type: "label" as const, label: "You’re all caught up" }]
      }
    />
  );
}

function QuickActions({ isAdmin }: { isAdmin: boolean }) {
  return (
    <Menu
      label="Create new"
      width="w-56"
      triggerClassName="inline-flex h-8 items-center gap-1.5 rounded-md bg-brand px-2.5 text-[13px] font-medium text-white hover:bg-brand-strong"
      trigger={
        <>
          <Plus className="size-4" aria-hidden />
          <span className="hidden sm:inline">New</span>
          <ChevronDown className="hidden size-3.5 opacity-70 sm:block" aria-hidden />
        </>
      }
      items={[
        { label: "Client", icon: <Users />, href: "/staff/clients/new" },
        { label: "Lead", icon: <Funnel />, href: "/staff/leads#new-lead" },
        { label: "Appointment", icon: <CalendarPlus />, href: "/staff/calendar#new-appointment" },
        ...(isAdmin ? [{ type: "separator" as const }, { label: "Invite team member", icon: <UserPlus />, href: "/staff/team#invite" }] : []),
      ]}
    />
  );
}

export function StaffShell({ sections, badges, initialCollapsed, workspace, user, notifications, children }: ShellProps) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  const [openedOn, setOpenedOn] = useState(pathname);
  // Close the mobile drawer whenever the route changes.
  if (mobileOpen && openedOn !== pathname) setMobileOpen(false);

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = `crm_sidebar=${next ? "collapsed" : "expanded"}; path=/; max-age=31536000; samesite=lax`;
  };

  const sidebar = (isMobile: boolean) => (
    <div className="flex h-full flex-col bg-brand text-white">
      <div className={cx("flex h-14 shrink-0 items-center gap-1 border-b border-white/10", collapsed && !isMobile ? "justify-center px-2" : "px-2.5")}>
        {collapsed && !isMobile ? null : <WorkspaceBrand workspace={workspace} />}
        {isMobile ? (
          <button type="button" onClick={() => setMobileOpen(false)} className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-white/70 hover:bg-white/10" aria-label="Close navigation">
            <X className="size-4" />
          </button>
        ) : (
          <button
            type="button"
            onClick={toggle}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-white/60 hover:bg-white/10 hover:text-white"
          >
            {collapsed ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}
          </button>
        )}
      </div>
      <nav aria-label="Main" className={cx("flex-1 overflow-y-auto py-3 scrollbar-thin", collapsed && !isMobile ? "px-2" : "px-2.5")}>
        <SidebarNav sections={sections} badges={badges} collapsed={collapsed && !isMobile} onNavigate={isMobile ? () => setMobileOpen(false) : undefined} />
      </nav>
    </div>
  );

  return (
    <div className={cx("min-h-dvh lg:grid", collapsed ? "lg:grid-cols-[56px_1fr]" : "lg:grid-cols-[248px_1fr]")}>
      <aside className="sticky top-0 hidden h-dvh lg:block">{sidebar(false)}</aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button type="button" className="absolute inset-0 bg-ink/40" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />
          <div className="relative h-full w-72 max-w-[85vw] shadow-lg">{sidebar(true)}</div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 border-b border-line bg-surface">
          <div className="flex h-14 items-center gap-3 px-4 lg:px-6">
            <button
              type="button"
              onClick={() => {
                setOpenedOn(pathname);
                setMobileOpen(true);
              }}
              className="inline-flex size-8 items-center justify-center rounded-md border border-line text-ink lg:hidden"
              aria-label="Open navigation"
            >
              <MenuIcon className="size-4" />
            </button>
            <Breadcrumbs sections={sections} />
            <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-2 md:flex-none">
              <div className="hidden w-72 sm:block xl:w-80">
                <GlobalSearch />
              </div>
              <Link href="/staff/search" className="inline-flex size-8 items-center justify-center rounded-md text-muted hover:bg-subtle sm:hidden" aria-label="Search">
                <Search className="size-4" />
              </Link>
              <Notifications items={notifications} />
              <QuickActions isAdmin={user.isAdmin} />
              <span className="mx-1 hidden h-6 w-px bg-line sm:block" aria-hidden />
              <UserMenu user={user} />
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-360 flex-1 px-4 py-5 lg:px-6 lg:py-6">{children}</main>
      </div>
    </div>
  );
}
