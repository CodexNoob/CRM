import type { EngagementStatus, LeadStatus } from "@/db/schema";
import type { Tone } from "@/components/ui";

/** One mapping from domain status to visual tone, used by every screen. */

export const ENGAGEMENT_TONE: Record<EngagementStatus, Tone> = {
  not_started: "neutral",
  waiting_on_client: "warn",
  in_progress: "info",
  in_review: "brand",
  ready_to_file: "brand",
  filed: "good",
  completed: "good",
  on_hold: "neutral",
};

export const LEAD_TONE: Record<LeadStatus, Tone> = {
  new: "warn",
  contacted: "info",
  qualified: "brand",
  converted: "good",
  lost: "neutral",
};

export const CLIENT_STATUS_TONE = { prospect: "info", active: "good", inactive: "neutral" } as const satisfies Record<string, Tone>;

/** Days between two ISO dates (to - from). */
export function daysBetween(fromIso: string, toIso: string) {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000);
}

export function dueLabel(due: string | null, today: string): { text: string; tone: Tone } {
  if (!due) return { text: "No due date", tone: "neutral" };
  const d = daysBetween(today, due);
  if (d < 0) return { text: `${-d}d overdue`, tone: "danger" };
  if (d === 0) return { text: "Due today", tone: "warn" };
  if (d <= 7) return { text: `In ${d}d`, tone: "warn" };
  return { text: `In ${d}d`, tone: "neutral" };
}

export const INVOICE_TONE = {
  draft: "neutral",
  sent: "warn",
  partially_paid: "info",
  paid: "good",
  cancelled: "neutral",
  refunded: "neutral",
} as const satisfies Record<string, Tone>;
