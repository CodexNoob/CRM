/**
 * Transactional email via Resend's HTTP API (no SDK dependency).
 * Server-only: reads RESEND_API_KEY, which must never reach the browser.
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
  const apiKey = process.env.RESEND_API_KEY?.trim() || "";
  return {
    apiKey,
    from: process.env.EMAIL_FROM?.trim() || "Website <onboarding@resend.dev>",
    inquiryTo: process.env.INQUIRY_NOTIFY_EMAIL?.trim() || "",
    isConfigured: apiKey.startsWith("re_"),
  };
}

export async function sendEmail(msg: EmailMessage): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const cfg = emailConfig();
  if (!cfg.isConfigured) return { ok: false, error: "Email is not configured" };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: cfg.from, to: [msg.to], subject: msg.subject, text: msg.text, html: msg.html }),
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
    if (!res.ok) return { ok: false, error: `${res.status} ${body.name ?? ""} ${body.message ?? ""}`.trim() };
    return { ok: true, id: body.id ?? "" };
  } catch (error) {
    return { ok: false, error: (error as Error)?.name ?? "Unknown error" };
  }
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
