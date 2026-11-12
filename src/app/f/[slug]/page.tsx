import type { Metadata } from "next";
import Link from "next/link";
import { cache } from "react";
import { notFound } from "next/navigation";
import { services, site, steps } from "@/content/site";
import { NotFoundError } from "@/lib/errors";
import { getDb } from "@/db";
import { buttonClass } from "@/components/ui";
import { SiteHeader } from "@/components/site/site-header";
import { ContactSection } from "@/components/site/contact-section";
import { CheckIcon, LockIcon, ServiceGlyph } from "@/components/site/icons";
import { formatDate, PORTAL_STATUS } from "@/lib/labels";
import { getFirmBySlug } from "@/services/firms";
import { getWebsiteContent, type PublicFirmProfile } from "@/services/settings";

/** Firm details and announcements come from the CRM (Settings). Cached for 5 minutes and refreshed on save. */
export const revalidate = 300;

/**
 * A firm's public page: /f/<firm slug>. Content comes from that firm's Settings.
 * Used only if the database is briefly unreachable: no contact details, so one firm's
 * details can never be shown on another firm's page.
 */
const OUTAGE_FALLBACK = (slug: string) => ({
  firmSlug: slug,
  profile: { name: "Our firm", phone: "", email: "", addressLines: [], hours: [], tagline: site.tagline, fromDatabase: false } as PublicFirmProfile,
  announcements: [] as { id: string; title: string; body: string; date: string }[],
});

const loadContent = cache(async (slug: string) => {
  const db = getDb();
  let firmId: string;
  try {
    firmId = (await getFirmBySlug(db, slug)).id;
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    logFallback(error);
    return OUTAGE_FALLBACK(slug);
  }
  try {
    return { firmSlug: slug, ...(await getWebsiteContent(db, firmId)) };
  } catch (error) {
    logFallback(error);
    return OUTAGE_FALLBACK(slug);
  }
});

function logFallback(error: unknown) {
  // The public site must stay up even if the database is briefly unreachable.
  // Log the error class and database code only (driver messages can contain query values).
  const e = error as { name?: string; code?: string; cause?: { name?: string; code?: string } };
  console.error("Website content fell back to defaults", { name: e?.name, code: e?.code ?? e?.cause?.code, cause: e?.cause?.name });
}

type Params = { params: Promise<{ slug: string }> };

const initialsOf = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "•";

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const { profile } = await loadContent(slug);
  return {
    title: { absolute: `${profile.name} | Tax preparation, consulting and accounting` },
    description: site.description,
    // The root layout keeps the app out of search results; public firm pages opt back in.
    robots: { index: true, follow: true },
    alternates: { canonical: `/f/${slug}` },
    openGraph: { type: "website", title: profile.name, description: site.description, siteName: profile.name },
  };
}

function structuredData(profile: PublicFirmProfile) {
  return {
    "@context": "https://schema.org",
    "@type": "AccountingService",
    name: profile.name,
    description: site.description,
    ...(profile.phone ? { telephone: profile.phone } : {}),
    ...(profile.email ? { email: profile.email } : {}),
    ...(profile.addressLines.length ? { address: { "@type": "PostalAddress", streetAddress: profile.addressLines.join(", ") } } : {}),
    makesOffer: services.map((s) => ({ "@type": "Offer", itemOffered: { "@type": "Service", name: s.title } })),
  };
}

function SectionHeading({ eyebrow, title, intro }: { eyebrow: string; title: string; intro?: string }) {
  return (
    <div className="mx-auto mb-10 max-w-2xl text-center">
      <p className="text-sm font-semibold uppercase tracking-wider text-brand-ink">{eyebrow}</p>
      <h2 className="mt-2 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">{title}</h2>
      {intro ? <p className="mt-3 text-base text-muted">{intro}</p> : null}
    </div>
  );
}

/** Illustration of the real portal view, built from the same status labels clients see. */
function PortalPreview() {
  const status = PORTAL_STATUS.waiting_on_client;
  const items = [
    { title: "Upload your W-2 forms", done: true },
    { title: "Complete the tax organizer", done: false },
    { title: "Sign your engagement letter", done: false },
  ];
  return (
    <figure className="relative">
      <div aria-hidden className="absolute -inset-4 -z-10 rounded-3xl bg-brand/10 blur-2xl" />
      <div className="rounded-2xl border border-line bg-surface p-5 shadow-xl shadow-brand/5 sm:p-6">
        <div className="flex items-center gap-2 text-xs text-muted">
          <LockIcon className="text-brand-ink" />
          <span>Client portal</span>
        </div>
        <div className="mt-4 flex items-start justify-between gap-3">
          <div>
            <p className="text-lg font-semibold text-ink">2026 Individual tax return</p>
            <p className="text-sm text-muted">Target date Apr 15, 2027</p>
          </div>
          <span className="whitespace-nowrap rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-900 dark:bg-amber-900/50 dark:text-amber-200">
            {status.label}
          </span>
        </div>
        <p className="mt-3 text-sm text-ink">{status.description}</p>
        <ul className="mt-4 divide-y divide-line rounded-lg border border-line">
          {items.map((i) => (
            <li key={i.title} className="flex items-center gap-3 px-3 py-2.5 text-sm">
              <span
                className={
                  "flex size-5 shrink-0 items-center justify-center rounded border " +
                  (i.done ? "border-brand bg-brand text-white" : "border-line")
                }
              >
                {i.done ? <CheckIcon className="size-3.5" /> : null}
              </span>
              <span className={i.done ? "text-muted line-through" : "text-ink"}>{i.title}</span>
            </li>
          ))}
        </ul>
      </div>
      <figcaption className="mt-3 text-center text-xs text-muted">Example of what clients see in the portal</figcaption>
    </figure>
  );
}

export default async function FirmPage({ params }: Params) {
  const { slug } = await params;
  const { profile, announcements, firmSlug } = await loadContent(slug);
  const telHref = `tel:${profile.phone.replace(/[^0-9+]/g, "")}`;
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData(profile)).replace(/</g, "\\u003c") }} />
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>
      <SiteHeader name={profile.name} homeHref={`/f/${firmSlug}`} />

      <main id="main">
        {/* Hero */}
        <section className="overflow-hidden">
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 sm:py-20 lg:grid-cols-2 lg:py-24">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-muted">
                <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden />
                {site.heroBadge}
              </p>
              <h1 className="mt-5 text-4xl font-semibold tracking-tight text-ink sm:text-5xl lg:text-[3.25rem] lg:leading-[1.1]">
                Taxes and accounting, handled clearly and on time.
              </h1>
              <p className="mt-5 max-w-xl text-lg text-muted">{site.description}</p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <a href="#contact" className={buttonClass("primary", "min-h-12 px-6 text-base")}>
                  Book a consultation
                </a>
                <a href="#services" className={buttonClass("secondary", "min-h-12 px-6 text-base")}>
                  Explore services
                </a>
              </div>
              <ul className="mt-8 grid gap-2 text-sm text-ink sm:grid-cols-2">
                {site.highlights.map((t) => (
                  <li key={t} className="flex items-center gap-2">
                    <CheckIcon className="text-brand-ink" />
                    {t}
                  </li>
                ))}
              </ul>
            </div>
            <PortalPreview />
          </div>
        </section>

        {/* Services */}
        <section id="services" className="scroll-mt-20 border-y border-line bg-surface py-16 sm:py-20">
          <div className="mx-auto max-w-6xl px-4">
            <SectionHeading
              eyebrow="Services"
              title="Everything your return and your books need"
              intro="One team for tax preparation, planning and the accounting behind it."
            />
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {services.map((s) => (
                <article key={s.title} className="flex flex-col rounded-xl border border-line bg-page p-6 transition-shadow hover:shadow-md">
                  <span className="flex size-11 items-center justify-center rounded-lg bg-brand/10 text-brand-ink">
                    <ServiceGlyph icon={s.icon} />
                  </span>
                  <h3 className="mt-4 text-lg font-semibold text-ink">{s.title}</h3>
                  <p className="mt-1.5 text-sm text-muted">{s.description}</p>
                  <ul className="mt-4 space-y-1.5 text-sm text-ink">
                    {s.points.map((p) => (
                      <li key={p} className="flex gap-2">
                        <CheckIcon className="mt-0.5 shrink-0 text-brand-ink" />
                        {p}
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
              <article className="flex flex-col justify-between rounded-xl bg-brand p-6 text-white">
                <div>
                  <h3 className="text-lg font-semibold">Not sure what you need?</h3>
                  <p className="mt-1.5 text-sm text-white/85">Tell us about your situation and we’ll recommend the right service.</p>
                </div>
                <a href="#contact" className="mt-6 inline-flex min-h-10 items-center justify-center rounded-md bg-white px-4 text-sm font-medium text-brand hover:bg-white/90">
                  Talk to us
                </a>
              </article>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="scroll-mt-20 py-16 sm:py-20">
          <div className="mx-auto max-w-6xl px-4">
            <SectionHeading eyebrow="How it works" title="A simple process, start to finish" />
            <ol className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {steps.map((s, i) => (
                <li key={s.title} className="relative rounded-xl border border-line bg-surface p-6">
                  <span className="flex size-9 items-center justify-center rounded-full bg-brand text-sm font-semibold text-white">{i + 1}</span>
                  <h3 className="mt-4 font-semibold text-ink">{s.title}</h3>
                  <p className="mt-1.5 text-sm text-muted">{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Portal */}
        <section id="portal" className="scroll-mt-20 border-y border-line bg-surface py-16 sm:py-20">
          <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 lg:grid-cols-2">
            <div>
              <p className="text-sm font-semibold uppercase tracking-wider text-brand-ink">Client portal</p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">Know where your return stands</h2>
              <p className="mt-3 text-muted">
                Every client gets a private portal login. No more wondering what’s happening or what we still need.
              </p>
              <ul className="mt-6 space-y-3 text-sm">
                {[
                  ["Follow progress", "See the status of each engagement in plain language."],
                  ["See what we need", "A to-do list of items we’re waiting on from you."],
                  ["Send documents securely", "Upload W-2s, 1099s and statements instead of emailing them."],
                  ["Message your preparer", "A private conversation with the firm, in one place."],
                  ["Private by design", "You see only your own information, behind your own sign-in."],
                ].map(([t, d]) => (
                  <li key={t} className="flex gap-3">
                    <CheckIcon className="mt-0.5 shrink-0 text-brand-ink" />
                    <span>
                      <span className="font-medium text-ink">{t}.</span> <span className="text-muted">{d}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl border border-line bg-page p-6 sm:p-8">
              <div className="flex items-center gap-3">
                <span className="flex size-11 items-center justify-center rounded-lg bg-brand/10 text-brand-ink">
                  <LockIcon />
                </span>
                <div>
                  <p className="font-semibold text-ink">Already a client?</p>
                  <p className="text-sm text-muted">Sign in with the email we invited.</p>
                </div>
              </div>
              <Link href="/login" className={buttonClass("primary", "mt-6 w-full min-h-12 text-base")}>
                Sign in to the client portal
              </Link>
              <p className="mt-4 text-xs text-muted">
                New clients receive a personal invitation link after their engagement begins. For your security, we never ask for passwords by phone or email.
              </p>
            </div>
          </div>
        </section>

        {/* Announcements */}
        {announcements.length ? (
          <section id="news" className="scroll-mt-20 py-16 sm:py-20" aria-labelledby="news-title">
            <div className="mx-auto max-w-3xl px-4">
              <h2 id="news-title" className="text-2xl font-semibold tracking-tight text-ink">
                Announcements
              </h2>
              <ul className="mt-6 space-y-4">
                {announcements.map((a) => (
                  <li key={a.id} className="rounded-xl border border-line bg-surface p-5">
                    <time dateTime={a.date} className="text-xs font-medium uppercase tracking-wide text-muted">
                      {formatDate(a.date)}
                    </time>
                    <h3 className="mt-1 font-semibold text-ink">{a.title}</h3>
                    <p className="mt-1 text-sm text-muted">{a.body}</p>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        ) : null}

        <ContactSection profile={profile} firmSlug={firmSlug} />
      </main>

      {/* Darker than the brand-colored Contact section above so the two don't merge; white focus ring because the default brand ring is invisible here. */}
      <footer className="border-t border-white/10 bg-brand-strong text-white [&_a:focus-visible]:outline-white">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1.2fr] lg:gap-8 lg:py-14">
          <div>
            <Link href={`/f/${firmSlug}`} className="inline-flex items-center gap-2.5 rounded-md font-semibold">
              <span aria-hidden className="flex size-9 items-center justify-center rounded-md bg-white/10 text-sm font-bold">
                {initialsOf(profile.name)}
              </span>
              <span>{profile.name}</span>
            </Link>
            <p className="mt-4 max-w-xs text-sm leading-6 text-white/75">{profile.tagline || site.tagline}</p>
          </div>

          <nav aria-labelledby="footer-explore" className="space-y-3">
            <h2 id="footer-explore" className="text-sm font-semibold">Explore</h2>
            <ul className="space-y-1 text-sm text-white/75">
              <li><a href="#services" className="inline-block py-1 transition-colors hover:text-white">Services</a></li>
              <li><a href="#how-it-works" className="inline-block py-1 transition-colors hover:text-white">How it works</a></li>
              <li><a href="#portal" className="inline-block py-1 transition-colors hover:text-white">Client portal</a></li>
              <li><a href="#contact" className="inline-block py-1 transition-colors hover:text-white">Contact us</a></li>
            </ul>
          </nav>

          <nav aria-labelledby="footer-clients" className="space-y-3">
            <h2 id="footer-clients" className="text-sm font-semibold">Client resources</h2>
            <ul className="space-y-1 text-sm text-white/75">
              <li><Link href="/login" className="inline-block py-1 transition-colors hover:text-white">Client portal login</Link></li>
              <li><a href="#contact" className="inline-block py-1 transition-colors hover:text-white">Book a consultation</a></li>
            </ul>
          </nav>

          <div className="space-y-3">
            <h2 className="text-sm font-semibold">Get in touch</h2>
            <address className="space-y-1 text-sm not-italic text-white/75">
              {profile.phone ? <a href={telHref} className="block py-1 transition-colors hover:text-white">{profile.phone}</a> : null}
              {profile.email ? <a href={`mailto:${profile.email}`} className="block break-all py-1 transition-colors hover:text-white">{profile.email}</a> : null}
              {profile.addressLines.length ? (
                <p className="py-1 leading-6">
                  {profile.addressLines.map((l) => (
                    <span key={l} className="block">{l}</span>
                  ))}
                </p>
              ) : null}
            </address>
            <p className="text-xs leading-5 text-white/60">Please don’t send tax documents or sensitive information by email.</p>
          </div>
        </div>

        <div className="border-t border-white/15">
          <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-5 text-xs leading-5 text-white/65 sm:flex-row sm:items-center sm:justify-between">
            <p>© {new Date().getFullYear()} {profile.name}. All rights reserved.</p>
            <p className="max-w-2xl sm:text-right">
              Information on this site is general and is not tax, legal or accounting advice for your situation.
            </p>
          </div>
        </div>
      </footer>
    </>
  );
}
