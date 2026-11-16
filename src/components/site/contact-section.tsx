import { buttonClass } from "@/components/ui";
import { EmailButton } from "@/components/site/email-button";
import { MailIcon, PhoneIcon, PinIcon } from "@/components/site/icons";
import { InquiryForm } from "@/components/site/inquiry-form";
import type { PlatformProfile } from "@/services/settings";

export function ContactSection({
  profile,
  title = "Contact us",
  intro = "Questions about the CRM? Send us a message or use the contact details below.",
}: {
  profile: PlatformProfile;
  title?: string;
  intro?: string;
}) {
  const phone = profile.phone || profile.supportPhone;
  const email = profile.officialEmail || profile.supportEmail || profile.salesEmail;
  const telHref = `tel:${phone.replace(/[^0-9+]/g, "")}`;
  const addressLines = [profile.addressLine1, profile.addressLine2].filter(Boolean);

  return (
    <section id="contact" className="scroll-mt-20 bg-brand py-16 text-white sm:py-20">
      <div className="mx-auto max-w-6xl px-4">
        <div className="max-w-2xl">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h2>
          <p className="mt-3 text-white/80">{intro}</p>
        </div>
        <div className="mt-8 grid gap-6 md:grid-cols-[18rem_1fr] lg:grid-cols-[22rem_1fr]">
          <aside className="flex flex-col overflow-hidden rounded-lg border border-white/10 bg-surface text-ink shadow-lg" aria-label="Platform contact details">
            <h3 className="border-b border-line px-5 py-3.5 text-[15px] font-semibold">Platform contact</h3>
            <dl className="divide-y divide-line text-[14px]">
              {phone ? (
                <div className="flex items-start gap-3 px-5 py-3.5">
                  <PhoneIcon className="mt-0.5 size-4 shrink-0 text-muted" />
                  <div className="min-w-0">
                    <dt className="text-[12px] text-muted">{profile.phone ? "Phone" : "Support phone"}</dt>
                    <dd><a href={telHref} className="font-medium hover:text-brand hover:underline">{phone}</a></dd>
                  </div>
                </div>
              ) : null}
              {email ? (
                <div className="flex items-start gap-3 px-5 py-3.5">
                  <MailIcon className="mt-0.5 size-4 shrink-0 text-muted" />
                  <div className="min-w-0">
                    <dt className="text-[12px] text-muted">Email</dt>
                    <dd className="break-all">
                      <a href={`mailto:${email}`} className="font-medium hover:text-brand hover:underline">{email}</a>
                    </dd>
                  </div>
                </div>
              ) : null}
              {profile.salesEmail ? (
                <div className="px-5 py-3.5">
                  <dt className="text-[12px] text-muted">Sales</dt>
                  <dd className="break-all"><a href={`mailto:${profile.salesEmail}`} className="font-medium hover:text-brand hover:underline">{profile.salesEmail}</a></dd>
                </div>
              ) : null}
              {profile.supportEmail ? (
                <div className="px-5 py-3.5">
                  <dt className="text-[12px] text-muted">Technical support</dt>
                  <dd className="break-all"><a href={`mailto:${profile.supportEmail}`} className="font-medium hover:text-brand hover:underline">{profile.supportEmail}</a></dd>
                </div>
              ) : null}
              {addressLines.length ? (
                <div className="flex items-start gap-3 px-5 py-3.5">
                  <PinIcon className="mt-0.5 size-4 shrink-0 text-muted" />
                  <div className="min-w-0">
                    <dt className="text-[12px] text-muted">Office</dt>
                    <dd>{addressLines.map((line) => <span key={line} className="block">{line}</span>)}</dd>
                  </div>
                </div>
              ) : null}
              {profile.websiteUrl ? (
                <div className="px-5 py-3.5">
                  <dt className="text-[12px] text-muted">Website</dt>
                  <dd className="break-all"><a href={profile.websiteUrl} target="_blank" rel="noopener noreferrer" className="font-medium hover:text-brand hover:underline">{profile.websiteUrl}</a></dd>
                </div>
              ) : null}
            </dl>
            <div className="mt-auto grid gap-2 border-t border-line bg-hover p-4">
              {phone ? <a href={telHref} className={buttonClass("primary", "w-full", "lg")}><PhoneIcon /> Call us</a> : null}
              {email ? (
                <EmailButton email={email} subject="CRM platform inquiry" className={buttonClass("secondary", "w-full", "lg")}>
                  <MailIcon /> Email us
                </EmailButton>
              ) : null}
              <p className="pt-1 text-[12px] leading-5 text-muted">Please don’t send passwords, tax documents, or other sensitive information.</p>
            </div>
          </aside>

          <div className="flex flex-col overflow-hidden rounded-lg border border-white/10 bg-surface text-ink shadow-lg">
            <h3 className="border-b border-line px-5 py-3.5 text-[15px] font-semibold">Send a message</h3>
            <div className="flex flex-1 flex-col p-5"><InquiryForm /></div>
          </div>
        </div>
      </div>
    </section>
  );
}
