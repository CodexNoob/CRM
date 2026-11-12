import { buttonClass } from "@/components/ui";
import { EmailButton } from "@/components/site/email-button";
import { MailIcon, PhoneIcon, PinIcon } from "@/components/site/icons";
import { InquiryForm } from "@/components/site/inquiry-form";
import type { PublicFirmProfile } from "@/services/settings";

/**
 * "Contact details" + "Send a message", shared by the product home page and every
 * firm's public page. Messages become leads in the CRM of the firm named by `firmSlug`.
 */
export function ContactSection({
  profile,
  firmSlug,
  title = "Book a consultation",
  intro = "Send us a message and we’ll get back to you within one business day, or reach us directly.",
  emailSubject = "Consultation inquiry",
}: {
  profile: PublicFirmProfile;
  firmSlug: string;
  title?: string;
  intro?: string;
  emailSubject?: string;
}) {
  const telHref = `tel:${profile.phone.replace(/[^0-9+]/g, "")}`;
  return (
    <section id="contact" className="scroll-mt-20 bg-brand py-16 text-white sm:py-20">
      <div className="mx-auto max-w-6xl px-4">
        <div className="max-w-2xl">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h2>
          <p className="mt-3 text-white/80">{intro}</p>
        </div>
        <div className="mt-8 grid gap-6 md:grid-cols-[18rem_1fr] lg:grid-cols-[22rem_1fr]">
          <aside className="flex flex-col overflow-hidden rounded-lg border border-white/10 bg-surface text-ink shadow-lg" aria-label="Contact details">
            <h3 className="border-b border-line px-5 py-3.5 text-[15px] font-semibold">Contact details</h3>
            <dl className="divide-y divide-line text-[14px]">
              {profile.phone ? (
                <div className="flex items-start gap-3 px-5 py-3.5">
                  <PhoneIcon className="mt-0.5 size-4 shrink-0 text-muted" />
                  <div className="min-w-0">
                    <dt className="text-[12px] text-muted">Phone</dt>
                    <dd>
                      <a href={telHref} className="font-medium hover:text-brand hover:underline">{profile.phone}</a>
                    </dd>
                  </div>
                </div>
              ) : null}
              {profile.email ? (
                <div className="flex items-start gap-3 px-5 py-3.5">
                  <MailIcon className="mt-0.5 size-4 shrink-0 text-muted" />
                  <div className="min-w-0">
                    <dt className="text-[12px] text-muted">Email</dt>
                    <dd className="break-all">
                      <a href={`mailto:${profile.email}`} className="font-medium hover:text-brand hover:underline">{profile.email}</a>
                    </dd>
                  </div>
                </div>
              ) : null}
              {profile.addressLines.length ? (
                <div className="flex items-start gap-3 px-5 py-3.5">
                  <PinIcon className="mt-0.5 size-4 shrink-0 text-muted" />
                  <div className="min-w-0">
                    <dt className="text-[12px] text-muted">Office</dt>
                    <dd>
                      {profile.addressLines.map((l) => (
                        <span key={l} className="block">{l}</span>
                      ))}
                    </dd>
                  </div>
                </div>
              ) : null}
              {profile.hours.length ? (
                <div className="px-5 py-3.5">
                  <dt className="text-[12px] text-muted">Office hours</dt>
                  <dd className="mt-1.5">
                    <table className="w-full text-[13px]">
                      <tbody>
                        {profile.hours.map(([d, h]) => (
                          <tr key={d}>
                            <td className="py-0.5 pr-3 text-muted">{d}</td>
                            <td className="whitespace-nowrap py-0.5 text-right font-medium tabular">{h}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </dd>
                </div>
              ) : null}
            </dl>
            <div className="mt-auto grid gap-2 border-t border-line bg-hover p-4">
              {profile.phone ? (
                <a href={telHref} className={buttonClass("primary", "w-full", "lg")}>
                  <PhoneIcon /> Call {profile.phone}
                </a>
              ) : null}
              {profile.email ? (
                <EmailButton email={profile.email} subject={emailSubject} className={buttonClass("secondary", "w-full", "lg")}>
                  <MailIcon /> Email us
                </EmailButton>
              ) : null}
              <p className="pt-1 text-[12px] leading-5 text-muted">Please don’t email tax documents or Social Security numbers. We’ll share a secure way to send them.</p>
            </div>
          </aside>

          <div className="flex flex-col overflow-hidden rounded-lg border border-white/10 bg-surface text-ink shadow-lg">
            <h3 className="border-b border-line px-5 py-3.5 text-[15px] font-semibold">Send a message</h3>
            <div className="flex flex-1 flex-col p-5">
              <InquiryForm firmSlug={firmSlug} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
