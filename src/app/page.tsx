import type { Metadata } from "next";
import Link from "next/link";
import { product, PLAN_INTERVALS } from "@/content/product";
import { buttonClass } from "@/components/ui";
import { CheckIcon, LockIcon } from "@/components/site/icons";
import { formatMoney } from "@/lib/labels";
import { site } from "@/content/site";
import { getDb } from "@/db";
import { ContactSection } from "@/components/site/contact-section";
import { getDefaultFirm } from "@/services/firms";
import { getPublicProfile, type PublicFirmProfile } from "@/services/settings";

/** Contact details come from the operator's own firm (the default firm). Cached for 5 minutes. */
export const revalidate = 300;

/** The operator's contact card. Messages sent from the home page become leads in the default firm's CRM. */
async function loadContact(): Promise<{ profile: PublicFirmProfile; firmSlug: string } | null> {
  const fallback: PublicFirmProfile = {
    name: site.name,
    phone: site.contact.phone,
    email: site.contact.email,
    addressLines: [...site.contact.addressLines],
    hours: site.contact.hours,
    tagline: site.tagline,
    fromDatabase: false,
  };
  try {
    const db = getDb();
    const firm = await getDefaultFirm(db);
    if (!firm) return null; // before first-run setup there is nowhere to deliver messages
    return { profile: await getPublicProfile(db, firm.id), firmSlug: firm.slug };
  } catch (error) {
    const e = error as { name?: string; code?: string; cause?: { code?: string } };
    console.error("Home page contact fell back to defaults", { name: e?.name, code: e?.code ?? e?.cause?.code });
    return { profile: fallback, firmSlug: "my-firm" };
  }
}

/** The product's marketing page: what the CRM does, pricing, and sign-up. Firms' own sites live at /f/<slug>. */
export const metadata: Metadata = {
  title: { absolute: `${product.name} | ${product.tagline}` },
  description: product.description,
  robots: { index: true, follow: true },
  alternates: { canonical: "/" },
  openGraph: { type: "website", title: product.name, description: product.description, siteName: product.name },
};

const faqs: [string, string][] = [
  ["Do I need a credit card for the free trial?", `No. Your ${product.trialDays}-day trial starts as soon as you sign up. Subscribe from inside the CRM whenever you’re ready.`],
  ["What happens when the trial ends?", "If you haven’t subscribed, your workspace pauses until you do. Nothing is deleted, and your clients can still reach their portal."],
  ["How do payments work?", "Subscriptions are paid through PayPal, by card or PayPal account. Card details never reach the CRM. Cancel anytime from the Subscription page."],
  ["Is our data kept separate from other firms?", "Yes. Every firm has its own private workspace; staff and clients only ever see their own firm’s records."],
];


export default async function ProductHome() {
  const contact = await loadContact();
  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>
      <header className="sticky top-0 z-30 border-b border-line bg-surface/90 backdrop-blur supports-backdrop-filter:bg-surface/75">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4">
          <Link href="/" className="flex items-center gap-2 font-semibold text-ink">
            <span aria-hidden className="flex size-8 items-center justify-center rounded-md bg-brand text-sm font-bold text-white">MY</span>
            <span>{product.name}</span>
          </Link>
          <nav aria-label="Main" className="ml-auto hidden items-center gap-1 text-sm md:flex">
            <a href="#features" className="rounded-md px-3 py-2 text-muted hover:bg-subtle hover:text-ink">Features</a>
            <a href="#pricing" className="rounded-md px-3 py-2 text-muted hover:bg-subtle hover:text-ink">Pricing</a>
            <a href="#faq" className="rounded-md px-3 py-2 text-muted hover:bg-subtle hover:text-ink">FAQ</a>
            {contact ? <a href="#contact" className="rounded-md px-3 py-2 text-muted hover:bg-subtle hover:text-ink">Contact</a> : null}
          </nav>
          <div className="ml-auto flex items-center gap-2 md:ml-0">
            <Link href="/login" className={buttonClass("ghost")}>Sign in</Link>
            <Link href="/signup" className={buttonClass("primary")}>Start free trial</Link>
          </div>
        </div>
      </header>

      <main id="main">
        <section className="mx-auto max-w-6xl px-4 py-16 text-center sm:py-24">
          <p className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-muted">
            <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden />
            {product.trialDays}-day free trial · no card required
          </p>
          <h1 className="mx-auto mt-5 max-w-3xl text-4xl font-semibold tracking-tight text-ink sm:text-5xl">{product.tagline}</h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-muted">{product.description}</p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Link href="/signup" className={buttonClass("primary", "min-h-12 px-6 text-base")}>Start your free trial</Link>
            <a href="#pricing" className={buttonClass("secondary", "min-h-12 px-6 text-base")}>See pricing</a>
          </div>
        </section>

        <section id="features" className="scroll-mt-20 border-y border-line bg-surface py-16 sm:py-20">
          <div className="mx-auto max-w-6xl px-4">
            <div className="mx-auto mb-10 max-w-2xl text-center">
              <p className="text-sm font-semibold uppercase tracking-wider text-brand-ink">Features</p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">Run the whole practice from one place</h2>
            </div>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {product.features.map((f) => (
                <article key={f.title} className="rounded-xl border border-line bg-page p-6">
                  <h3 className="text-lg font-semibold text-ink">{f.title}</h3>
                  <p className="mt-1.5 text-sm text-muted">{f.body}</p>
                </article>
              ))}
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
              <LockIcon className="text-brand-ink" /> Prices in USD. Payments are processed securely by PayPal.
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

        {contact ? (
          <ContactSection
            profile={contact.profile}
            firmSlug={contact.firmSlug}
            title="Contact us"
            intro={`Questions about ${product.name}, pricing or setting up your firm? Send us a message and we’ll get back to you within one business day, or reach us directly.`}
            emailSubject={`Question about ${product.name}`}
          />
        ) : null}
      </main>

      <footer className="border-t border-white/10 bg-brand-strong text-white [&_a:focus-visible]:outline-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 text-sm text-white/75 sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} {product.name}</p>
          <nav aria-label="Footer" className="flex flex-wrap gap-4">
            <a href="#pricing" className="hover:text-white">Pricing</a>
            {contact ? <a href="#contact" className="hover:text-white">Contact</a> : null}
            <Link href="/signup" className="hover:text-white">Start free trial</Link>
            <Link href="/login" className="hover:text-white">Sign in</Link>
          </nav>
        </div>
      </footer>
    </>
  );
}
