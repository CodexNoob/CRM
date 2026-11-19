import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { CalendarClock, CircleDollarSign, FolderKanban, MonitorSmartphone, ShieldCheck, UsersRound } from "lucide-react";
import { product, PLAN_INTERVALS } from "@/content/product";
import { buttonClass } from "@/components/ui";
import { CheckIcon, LockIcon } from "@/components/site/icons";
import { formatMoney } from "@/lib/labels";
import { getDb } from "@/db";
import { ContactSection } from "@/components/site/contact-section";
import { getPlatformProfile, type PlatformProfile } from "@/services/settings";

/** The product site uses only the platform operator's identity. Cached for 5 minutes. */
export const revalidate = 300;

async function loadPlatformProfile(): Promise<PlatformProfile> {
  try {
    return await getPlatformProfile(getDb());
  } catch (error) {
    const e = error as { name?: string; code?: string; cause?: { code?: string } };
    console.error("Platform profile could not be loaded", { name: e?.name, code: e?.code ?? e?.cause?.code });
    return {
      name: product.name,
      description: product.description,
      websiteUrl: "",
      officialEmail: "",
      phone: "",
      addressLine1: "",
      addressLine2: "",
      salesEmail: "",
      supportEmail: "",
      supportPhone: "",
      logoDataUrl: null,
      fromDatabase: false,
    };
  }
}

/** The product's marketing page: what the CRM does, pricing, and sign-up. */
export async function generateMetadata(): Promise<Metadata> {
  const profile = await loadPlatformProfile();
  return {
  title: { absolute: `${profile.name} | ${product.tagline}` },
  description: profile.description,
  robots: { index: true, follow: true },
  alternates: { canonical: "/" },
  openGraph: { type: "website", title: profile.name, description: profile.description, siteName: profile.name },
  };
}

const faqs: [string, string][] = [
  ["Do I need a credit card for the free trial?", `No. Your ${product.trialDays}-day trial starts as soon as you sign up. Subscribe from inside the CRM whenever you’re ready.`],
  ["What happens when the trial ends?", "If you haven’t subscribed, your workspace pauses until you do. Nothing is deleted, and your clients can still reach their portal."],
  ["How do payments work?", "CRM subscriptions are billed through PayPal. Card details never reach this app; QuickBooks is an optional integration for a firm’s own client billing."],
  ["Is our data kept separate from other firms?", "Yes. Every firm has its own private workspace; staff and clients only ever see their own firm’s records."],
];

const featureIcons = [UsersRound, CalendarClock, MonitorSmartphone, CircleDollarSign, FolderKanban, ShieldCheck] as const;


export default async function ProductHome() {
  const profile = await loadPlatformProfile();
  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>
      <header className="sticky top-0 z-30 border-b border-white/60 bg-white/80 backdrop-blur-xl supports-backdrop-filter:bg-white/70">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4">
          <Link href="/" className="flex items-center gap-2 font-semibold text-ink">
            {profile.logoDataUrl ? (
              <Image src={profile.logoDataUrl} alt="" width={32} height={32} unoptimized className="size-8 rounded-md object-contain" />
            ) : (
              <span aria-hidden className="flex size-8 items-center justify-center rounded-md bg-brand text-sm font-bold text-white">
                {profile.name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]!.toUpperCase()).join("") || "CRM"}
              </span>
            )}
            <span>{profile.name}</span>
          </Link>
          <nav aria-label="Main" className="ml-auto hidden items-center gap-1 text-sm md:flex">
            <a href="#features" className="rounded-md px-3 py-2 text-muted hover:bg-subtle hover:text-ink">Features</a>
            <a href="#pricing" className="rounded-md px-3 py-2 text-muted hover:bg-subtle hover:text-ink">Pricing</a>
            <a href="#faq" className="rounded-md px-3 py-2 text-muted hover:bg-subtle hover:text-ink">FAQ</a>
            <a href="#contact" className="rounded-md px-3 py-2 text-muted hover:bg-subtle hover:text-ink">Contact</a>
          </nav>
          <div className="ml-auto flex items-center gap-2 md:ml-0">
            <Link href="/login" className={buttonClass("ghost")}>Sign in</Link>
            <Link href="/signup" className={buttonClass("primary")}>Start free trial</Link>
          </div>
        </div>
      </header>

      <main id="main" className="overflow-hidden bg-[#f7f9fc]">
        <section className="relative isolate overflow-hidden border-b border-slate-200/70 bg-[#eef4fb]">
          <div aria-hidden className="crm-hero-art absolute inset-0 z-0" />
          <div aria-hidden className="crm-hero-glow absolute -right-24 top-8 z-0 size-136 rounded-full bg-cyan-300/25 blur-3xl" />
          <div className="relative z-10 mx-auto grid min-h-170 max-w-360 items-center gap-12 px-5 py-16 sm:px-8 sm:py-24 lg:grid-cols-[0.72fr_1.28fr] lg:gap-7 lg:py-24">
            <div className="crm-enter relative z-10 max-w-xl">
              <p className="inline-flex items-center gap-2 rounded-full border border-white/80 bg-white/75 px-3.5 py-1.5 text-xs font-semibold tracking-wide text-slate-700 shadow-sm backdrop-blur"><span className="size-2 rounded-full bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.12)]" aria-hidden />MADE FOR MODERN ACCOUNTING FIRMS</p>
              <h1 className="mt-6 max-w-2xl text-5xl font-semibold leading-[1.04] tracking-[-0.045em] text-slate-950 sm:text-6xl lg:text-[4.4rem]">{product.tagline}</h1>
              <p className="mt-6 max-w-lg text-lg leading-8 text-slate-600">{profile.description}</p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row"><Link href="/signup" className={buttonClass("primary", "min-h-12 px-6 text-base shadow-lg shadow-blue-950/15 transition duration-200 hover:-translate-y-0.5 hover:shadow-xl")}>Start your free trial <span aria-hidden>→</span></Link><a href="#features" className="inline-flex min-h-12 items-center justify-center rounded-lg border border-slate-300/80 bg-white/70 px-6 text-sm font-semibold text-slate-800 shadow-sm backdrop-blur transition hover:-translate-y-0.5 hover:bg-white">Explore the platform</a></div>
              <p className="mt-4 text-xs font-medium text-slate-500">{product.trialDays} days free <span className="mx-1.5">·</span> No credit card required <span className="mx-1.5">·</span> Setup in minutes</p>
              <div className="mt-10 flex items-center gap-4 border-t border-slate-300/60 pt-6"><div className="flex -space-x-2" aria-hidden><span className="flex size-9 items-center justify-center rounded-full border-2 border-[#eef4fb] bg-blue-900 text-xs font-bold text-white">A</span><span className="flex size-9 items-center justify-center rounded-full border-2 border-[#eef4fb] bg-teal-700 text-xs font-bold text-white">M</span><span className="flex size-9 items-center justify-center rounded-full border-2 border-[#eef4fb] bg-amber-600 text-xs font-bold text-white">J</span></div><p className="text-xs leading-5 text-slate-600"><span className="block font-semibold text-slate-800">Your whole practice, in sync</span>Clients, work, documents and billing together.</p></div>
            </div>
            <div className="crm-enter crm-enter-delay relative mx-auto w-full max-w-none lg:ml-auto lg:scale-[1.1] lg:origin-left">
              <div aria-hidden className="absolute -inset-8 rounded-[2.5rem] bg-linear-to-br from-blue-300/35 via-indigo-200/25 to-cyan-200/40 blur-2xl" />
              <div className="crm-float relative overflow-hidden rounded-xl border border-white/80 bg-white p-2 shadow-[0_32px_90px_-35px_rgba(25,54,92,0.45)] sm:rounded-2xl sm:p-3">
                <Image
                  src="/crm-dashboard-screenshot-v2.png"
                  alt="Personal CRM dashboard showing the workspace, client overview, upcoming deadlines, and lead pipeline"
                  width={1208}
                  height={733}
                  priority
                  className="h-auto w-full rounded-lg border border-slate-200/80 shadow-sm sm:rounded-xl"
                />
              </div>
              <div className="crm-float absolute -left-5 bottom-10 hidden items-center gap-2 rounded-xl border border-white bg-white/95 p-3 shadow-xl backdrop-blur sm:flex"><span className="flex size-8 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">✓</span><span className="text-[10px] font-semibold text-slate-800">Client work, on track</span></div>
              <div className="crm-float crm-float-late absolute right-10 top-10 hidden rounded-xl border border-white bg-white/95 p-3 shadow-xl backdrop-blur sm:block"><p className="text-[9px] text-slate-500">Your workspace</p><p className="mt-1 text-sm font-semibold text-slate-900">Everything in sync</p></div>
            </div>
          </div>
          <div className="absolute inset-x-0 bottom-0 h-20 bg-linear-to-t from-[#f7f9fc] to-transparent" aria-hidden />
        </section>

        <section id="features" className="scroll-mt-20 border-y border-slate-200/80 bg-white py-20 sm:py-28">
          <div className="mx-auto max-w-6xl px-4">
            <div className="mx-auto mb-10 max-w-2xl text-center">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-800">One connected workspace</p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">Run the whole practice from one place</h2>
            </div>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {product.features.map((f, index) => {
                const FeatureIcon = featureIcons[index]!;
                return (
                <article key={f.title} className="group rounded-2xl border border-slate-200/80 bg-linear-to-br from-white to-slate-50 p-6 shadow-sm transition duration-300 hover:-translate-y-1 hover:border-blue-200 hover:shadow-xl hover:shadow-blue-950/5">
                  <span className="mb-5 flex size-10 items-center justify-center rounded-xl bg-blue-50 text-blue-800 transition group-hover:bg-blue-900 group-hover:text-white"><FeatureIcon className="size-5" aria-hidden /></span>
                  <h3 className="text-lg font-semibold text-slate-900">{f.title}</h3>
                  <p className="mt-1.5 text-sm leading-6 text-slate-600">{f.body}</p>
                </article>
                );
              })}
            </div>
          </div>
        </section>

        <section id="pricing" className="scroll-mt-20 py-16 sm:py-20" aria-labelledby="pricing-title">
          <div className="mx-auto max-w-4xl px-4">
            <div className="mx-auto mb-10 max-w-2xl text-center">
              <p className="text-sm font-semibold uppercase tracking-wider text-brand-ink">Pricing</p>
              <h2 id="pricing-title" className="mt-2 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">One simple price per firm</h2>
              <p className="mt-3 text-muted">Everything included, for your whole team. Start with {product.trialDays} days free.</p>
            </div>
            <div className="grid gap-5 md:grid-cols-2">
              {PLAN_INTERVALS.map((interval) => {
                const plan = product.plans[interval];
                const featured = interval === "year";
                return (
                  <article key={interval} className={"relative flex flex-col rounded-2xl border bg-surface p-6 sm:p-8 " + (featured ? "border-brand shadow-lg shadow-brand/10" : "border-line")}>
                    {featured ? <span className="absolute -top-3 left-6 rounded-full bg-brand px-3 py-1 text-xs font-medium text-white">2 months free</span> : null}
                    <h3 className="text-lg font-semibold text-ink">{plan.label}</h3>
                    <p className="mt-3 text-4xl font-semibold tracking-tight text-ink tabular">
                      {formatMoney(plan.amountCents)}
                      <span className="text-base font-normal text-muted"> / {plan.per}</span>
                    </p>
                    <p className="mt-1 text-sm text-muted">{plan.note}</p>
                    <ul className="mt-6 flex-1 space-y-2 text-sm text-ink">
                      {product.included.map((f) => (
                        <li key={f} className="flex gap-2">
                          <CheckIcon className="mt-0.5 shrink-0 text-brand-ink" />
                          {f}
                        </li>
                      ))}
                    </ul>
                    <Link href={`/signup?plan=${interval}`} className={buttonClass(featured ? "primary" : "secondary", "mt-8 min-h-12 w-full text-base")}>
                      Start free trial
                    </Link>
                  </article>
                );
              })}
            </div>
            <p className="mt-6 flex items-center justify-center gap-2 text-center text-xs text-muted">
              <LockIcon className="text-brand-ink" /> Prices in USD. CRM subscriptions are billed through PayPal; card details never reach this app.
            </p>
          </div>
        </section>

        <section id="faq" className="scroll-mt-20 border-t border-line bg-surface py-16 sm:py-20" aria-labelledby="faq-title">
          <div className="mx-auto max-w-3xl px-4">
            <h2 id="faq-title" className="text-2xl font-semibold tracking-tight text-ink">Questions</h2>
            <dl className="mt-6 divide-y divide-line">
              {faqs.map(([q, a]) => (
                <div key={q} className="py-4">
                  <dt className="font-medium text-ink">{q}</dt>
                  <dd className="mt-1 text-sm text-muted">{a}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <ContactSection
          profile={{
            ...profile,
            officialEmail: profile.officialEmail || "charlesjohnduot@gmail.com",
            phone: profile.phone || "09197621060",
            addressLine1: profile.addressLine1 || "Rodriguez Rizal, Philippines",
          }}
          title="Contact us"
          intro={`Questions about ${profile.name}, pricing or setting up your firm? Send us a message and we’ll get back to you within one business day, or reach us directly.`}
        />
      </main>

      <footer className="border-t border-white/10 bg-brand-strong text-white [&_a:focus-visible]:outline-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 text-sm text-white/75 sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} {profile.name}</p>
          <nav aria-label="Footer" className="flex flex-wrap gap-4">
            <a href="#pricing" className="hover:text-white">Pricing</a>
            <a href="#contact" className="hover:text-white">Contact</a>
            <Link href="/signup" className="hover:text-white">Start free trial</Link>
            <Link href="/login" className="hover:text-white">Sign in</Link>
          </nav>
        </div>
      </footer>
    </>
  );
}
