import Link from "next/link";
import { site } from "@/content/site";
import { buttonClass } from "@/components/ui";
import { MenuIcon } from "./icons";

const nav = [
  { href: "#services", label: "Services" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#portal", label: "Client portal" },
  { href: "#contact", label: "Contact" },
];

export function SiteHeader({ name = site.name }: { name?: string }) {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface/90 backdrop-blur supports-backdrop-filter:bg-surface/75">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold text-ink">
          <span aria-hidden className="flex size-8 items-center justify-center rounded-md bg-brand text-sm font-bold text-white">
            {site.shortName}
          </span>
          <span>{name}</span>
        </Link>

        <nav aria-label="Main" className="ml-auto hidden items-center gap-1 text-sm md:flex">
          {nav.map((n) => (
            <a key={n.href} href={n.href} className="rounded-md px-3 py-2 text-muted hover:bg-subtle hover:text-ink">
              {n.label}
            </a>
          ))}
        </nav>
        <div className="ml-auto hidden items-center gap-2 md:ml-0 md:flex">
          <Link href="/login" className={buttonClass("secondary")}>
            Client login
          </Link>
          <a href="#contact" className={buttonClass("primary")}>
            Book a consultation
          </a>
        </div>

        {/* Mobile menu: works without JavaScript. */}
        <details className="group relative ml-auto md:hidden">
          <summary className="flex size-10 cursor-pointer list-none items-center justify-center rounded-md border border-line text-ink [&::-webkit-details-marker]:hidden">
            <MenuIcon />
            <span className="sr-only">Open menu</span>
          </summary>
          <div className="absolute right-0 mt-2 w-64 rounded-lg border border-line bg-surface p-2 shadow-lg">
            <nav aria-label="Mobile" className="flex flex-col text-sm">
              {nav.map((n) => (
                <a key={n.href} href={n.href} className="rounded-md px-3 py-2.5 text-ink hover:bg-subtle">
                  {n.label}
                </a>
              ))}
            </nav>
            <div className="mt-2 grid gap-2 border-t border-line pt-2">
              <Link href="/login" className={buttonClass("secondary", "w-full")}>
                Client login
              </Link>
              <a href="#contact" className={buttonClass("primary", "w-full")}>
                Book a consultation
              </a>
            </div>
          </div>
        </details>
      </div>
    </header>
  );
}
