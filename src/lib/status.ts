import type { EngagementStatus, LeadStatus, TaskStatus } from "@/db/schema";
import type { Tone } from "@/components/ui";

/** One mapping from domain status to visual tone, used by every screen. */

export const ENGAGEMENT_TONE: Record<EngagementStatus, Tone> = {
  draft: "neutral",
  proposal_sent: "info",
  awaiting_acceptance: "warn",
  active: "info",
  not_started: "neutral",
  waiting_on_client: "warn",
  in_progress: "info",
  in_review: "brand",
  ready_to_file: "brand",
  filed: "good",
  completed: "good",
  on_hold: "neutral",
  cancelled: "neutral",
  closed: "good",
};

export const LEAD_TONE: Record<LeadStatus, Tone> = {
  new: "warn",
  contacted: "info",
  qualified: "brand",
  consultation_scheduled: "brand",
  proposal_sent: "brand",
  negotiation: "warn",
  converted: "good",
  lost: "neutral",
  nurture: "neutral",
};

export const TASK_TONE: Record<TaskStatus, Tone> = {
  todo: "neutral",
  in_progress: "info",
  waiting_client: "warn",
  waiting_review: "brand",
  blocked: "danger",
  completed: "good",
  cancelled: "neutral",
};

export const PRIORITY_TONE = { low: "neutral", normal: "neutral", high: "warn", urgent: "danger" } as const satisfies Record<string, Tone>;

export const ONBOARDING_TONE = {
  not_started: "neutral",
  information_requested: "info",
  awaiting_documents: "warn",
  under_verification: "brand",
  completed: "good",
} as const satisfies Record<string, Tone>;

/* ───────── Shared status groups (use these instead of repeating literal lists) ───────── */

/** Engagement statuses before the work is approved to start. */
export const ENGAGEMENT_PRE_WORK: readonly EngagementStatus[] = ["draft", "proposal_sent", "awaiting_acceptance"];
/** Engagements whose work is finished or stopped (not counted as open work). */
export const ENGAGEMENT_DONE: readonly EngagementStatus[] = ["filed", "completed", "cancelled", "closed"];
/** Engagements with work under way or ready to start. */
export const ENGAGEMENT_OPEN: readonly EngagementStatus[] = ["active", "not_started", "waiting_on_client", "in_progress", "in_review", "ready_to_file", "on_hold"];
/** Task statuses that still need doing. */
export const TASK_OPEN: readonly TaskStatus[] = ["todo", "in_progress", "waiting_client", "waiting_review", "blocked"];
export const TASK_CLOSED: readonly TaskStatus[] = ["completed", "cancelled"];
/** Lead stages still in the pipeline. */
export const LEAD_OPEN: readonly LeadStatus[] = ["new", "contacted", "qualified", "consultation_scheduled", "proposal_sent", "negotiation", "nurture"];
export const CLIENT_STATUS_TONE = { prospect: "info", onboarding: "warn", active: "good", inactive: "neutral", on_hold: "neutral", former: "neutral" } as const satisfies Record<string, Tone>;

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
