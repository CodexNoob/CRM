import type { ConversationCategory, ConversationStatus } from "@/db/schema";
import type { Tone } from "@/components/ui";

/** Conversation labels shared by the staff inbox and the client portal. */
export const CONVERSATION_STATUS_LABELS: Record<ConversationStatus, string> = {
  open: "Open",
  waiting_for_client: "Waiting for client",
  waiting_for_staff: "Waiting for staff",
  in_progress: "In progress",
  resolved: "Resolved",
  closed: "Closed",
};

/** How the client sees each status (no internal jargon). */
export const PORTAL_CONVERSATION_STATUS: Record<ConversationStatus, string> = {
  open: "Open",
  waiting_for_client: "Awaiting your reply",
  waiting_for_staff: "With the firm",
  in_progress: "In progress",
  resolved: "Resolved",
  closed: "Closed",
};

export const CONVERSATION_STATUS_TONE: Record<ConversationStatus, Tone> = {
  open: "info",
  waiting_for_client: "warn",
  waiting_for_staff: "brand",
  in_progress: "info",
  resolved: "good",
  closed: "neutral",
};

export const CONVERSATION_CATEGORY_LABELS: Record<ConversationCategory, string> = {
  general_inquiry: "General inquiry",
  document_request: "Document request",
  tax_preparation: "Tax preparation",
  tax_return: "Tax return",
  bookkeeping: "Bookkeeping",
  billing: "Billing",
  appointment: "Appointment",
  engagement: "Engagement",
  other: "Other",
};

export const INBOX_FOLDERS = [
  { key: "inbox", label: "Inbox" },
  { key: "sent", label: "Sent" },
  { key: "mine", label: "Assigned to me" },
  { key: "unassigned", label: "Unassigned" },
  { key: "waiting_for_client", label: "Waiting for client" },
  { key: "waiting_for_staff", label: "Waiting for staff" },
  { key: "resolved", label: "Resolved" },
  { key: "closed", label: "Closed" },
] as const;

export function conversationNumber(n: number | null | undefined) {
  return n ? `M-${String(n).padStart(4, "0")}` : null;
}
