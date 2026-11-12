import { emailConfig, escapeHtml, sendEmail } from "@/integrations/email";
import { SERVICE_LABELS } from "@/lib/labels";

function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

/**
 * Alerts the firm that a website inquiry arrived. Deliberately minimal: name, service
 * and a link to the lead. The visitor's message and contact details stay in the CRM,
 * behind sign-in, because people sometimes include sensitive tax information.
 * Never throws: the lead is already saved, so a failed email must not fail the form.
 */
export async function notifyNewInquiry(lead: { id: string; name: string; serviceInterest: string | null }): Promise<void> {
  const cfg = emailConfig();
  if (!cfg.isConfigured || !cfg.inquiryTo) return;

  const service = lead.serviceInterest ? (SERVICE_LABELS[lead.serviceInterest as keyof typeof SERVICE_LABELS] ?? "Not specified") : "Not sure yet";
  const link = `${appUrl()}/staff/leads/${lead.id}`;
  // Keep the name single-line and short so it can't reshape the subject.
  const name = lead.name.replace(/[\r\n]+/g, " ").slice(0, 80);

  const result = await sendEmail({
    to: cfg.inquiryTo,
    subject: `New website inquiry from ${name}`,
    text: [
      "You have a new message from the website contact form.",
      "",
      `Name: ${name}`,
      `Needs help with: ${service}`,
      "",
      `Open the lead in the CRM to read the message and reply:`,
      link,
    ].join("\n"),
    html: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#202b38">
  <p>You have a new message from the website contact form.</p>
  <table cellpadding="0" cellspacing="0" style="margin:12px 0">
    <tr><td style="padding:2px 12px 2px 0;color:#6b7280">Name</td><td><strong>${escapeHtml(name)}</strong></td></tr>
    <tr><td style="padding:2px 12px 2px 0;color:#6b7280">Needs help with</td><td>${escapeHtml(service)}</td></tr>
  </table>
  <p><a href="${escapeHtml(link)}" style="display:inline-block;background:#1f3a56;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:6px">Open the lead in the CRM</a></p>
  <p style="font-size:13px;color:#6b7280">The message and contact details are kept in the CRM for privacy. Sign in to read them.</p>
</div>`,
  });

  if (!result.ok) console.error("Inquiry alert email failed", { leadId: lead.id, error: result.error });
}
