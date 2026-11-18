/**
 * Transactional email via Resend or Brevo's server-side APIs.
 * Provider keys are read only inside sendEmail and never returned by emailConfig.
 *
 * Email is best-effort. Callers must treat a failed send as non-fatal: the CRM
 * record is the source of truth, and the email is only an alert.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export function emailConfig() {
  const requestedProvider = process.env.EMAIL_PROVIDER?.trim().toLowerCase() || "resend";
  const provider = requestedProvider === "brevo" || requestedProvider === "resend" ? requestedProvider : null;
  return {
    provider,
    providerLabel: provider === "brevo" ? "Brevo" : provider === "resend" ? "Resend" : "Unknown email provider",
    from: process.env.EMAIL_FROM?.trim() || (provider === "resend" ? "Website <onboarding@resend.dev>" : ""),
    inquiryTo: process.env.INQUIRY_NOTIFY_EMAIL?.trim() || "",
    isConfigured: provider === "resend"
      ? !!process.env.RESEND_API_KEY?.trim().startsWith("re_")
      : provider === "brevo"
        ? !!process.env.BREVO_API_KEY?.trim() && !!senderFrom(process.env.EMAIL_FROM?.trim() ?? "")
        : false,
  };
}

function senderFrom(value: string): { name: string; email: string } | null {
  const named = value.match(/^\s*(.*?)\s*<([^<>]+)>\s*$/);
  const name = named?.[1]?.trim() || "Personal CRM";
  const email = (named?.[2] ?? value).trim();
  return /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(email) ? { name, email } : null;
}

export async function sendEmail(msg: EmailMessage): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const cfg = emailConfig();
  if (!cfg.isConfigured) return { ok: false, error: "Email is not configured" };
  try {
    if (cfg.provider === "brevo") {
      const sender = senderFrom(cfg.from);
      const res = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
          "api-key": process.env.BREVO_API_KEY!.trim(),
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          sender,
          to: [{ email: msg.to }],
          subject: msg.subject,
          textContent: msg.text,
          htmlContent: msg.html,
        }),
        signal: AbortSignal.timeout(8000),
        cache: "no-store",
      });
      const body = (await res.json().catch(() => ({}))) as { messageId?: string; code?: string };
      if (!res.ok) return { ok: false, error: `${res.status} ${body.code ?? "brevo_error"}` };
      return { ok: true, id: body.messageId ?? "" };
    }

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY!.trim()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: cfg.from, to: [msg.to], subject: msg.subject, text: msg.text, html: msg.html }),
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; name?: string };
    if (!res.ok) return { ok: false, error: `${res.status} ${body.name ?? "resend_error"}` };
    return { ok: true, id: body.id ?? "" };
  } catch (error) {
    return { ok: false, error: (error as Error)?.name ?? "Unknown error" };
  }
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
