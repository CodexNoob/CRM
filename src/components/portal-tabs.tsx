"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function PortalTabs({ unread, openInvoices = 0 }: { unread: number; openInvoices?: number }) {
  const pathname = usePathname();
  const tabs = [
    { href: "/portal", label: "Overview" },
    { href: "/portal/documents", label: "Documents" },
    { href: "/portal/invoices", label: "Billing", count: openInvoices, countLabel: " to pay" },
    { href: "/portal/messages", label: "Messages", count: unread, countLabel: " unread" },
  ];
  return (
    <nav aria-label="Portal" className="-mb-px flex gap-1 overflow-x-auto">
      {tabs.map((t) => {
        const active = pathname === t.href;
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
                <span className="sr-only">{t.countLabel}</span>
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
