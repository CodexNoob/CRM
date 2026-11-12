/**
 * Sends one test email to INQUIRY_NOTIFY_EMAIL to confirm email delivery works.
 *   npm run email:test
 * Prints no secrets.
 */
import "./env";
import { emailConfig, sendEmail } from "@/integrations/email";

const cfg = emailConfig();
if (!cfg.isConfigured || !cfg.inquiryTo) {
  console.error("Set RESEND_API_KEY and INQUIRY_NOTIFY_EMAIL in .env.local first.");
  process.exit(1);
}

const result = await sendEmail({
  to: cfg.inquiryTo,
  subject: "Test: website inquiry alerts are connected",
  text: "This is a test from your CRM. New messages from the website contact form will be announced like this.",
  html: "<p>This is a test from your CRM. New messages from the website contact form will be announced like this.</p>",
});
console.log(result.ok ? `Sent to ${cfg.inquiryTo} (id ${result.id})` : `Failed: ${result.error}`);
if (!result.ok) process.exitCode = 1;
