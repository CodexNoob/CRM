import type { ClientStatus, ClientType, EngagementStatus, LeadStatus, ServiceType, UserRole } from "@/db/schema";

export const SERVICE_LABELS: Record<ServiceType, string> = {
  individual_tax: "Individual tax return",
  business_tax: "Business tax return",
  tax_consulting: "Tax consulting",
  bookkeeping: "Bookkeeping",
  accounting: "Accounting",
  other: "Other",
};

export const STATUS_LABELS: Record<EngagementStatus, string> = {
  draft: "Draft",
  proposal_sent: "Proposal sent",
  awaiting_acceptance: "Awaiting acceptance",
  active: "Active",
  not_started: "Not started",
  waiting_on_client: "Waiting on client",
  in_progress: "In progress",
  in_review: "Under review",
  ready_to_file: "Ready to file",
  filed: "Filed",
  completed: "Completed",
  on_hold: "On hold",
  cancelled: "Cancelled",
  closed: "Closed",
};

/** Plain-language status for clients. Deliberately reveals no internal detail. */
export const PORTAL_STATUS: Record<EngagementStatus, { label: string; description: string }> = {
  draft: { label: "Being prepared", description: "We are preparing your engagement." },
  proposal_sent: { label: "Proposal sent", description: "We sent you a proposal. Let us know if you have questions." },
  awaiting_acceptance: { label: "Awaiting your approval", description: "Please review and accept the engagement so we can begin." },
  active: { label: "Getting started", description: "Your engagement is approved and we will begin soon." },
  not_started: { label: "Getting started", description: "We have your engagement and will begin soon." },
  waiting_on_client: {
    label: "Waiting on you",
    description: "We need something from you. Check your to-do items below.",
  },
  in_progress: { label: "In progress", description: "We are working on this now." },
  in_review: { label: "In review", description: "Your work is being reviewed before it is finalized." },
  ready_to_file: { label: "Almost done", description: "We will contact you if anything else is needed." },
  filed: { label: "Filed", description: "This has been filed." },
  completed: { label: "Complete", description: "This engagement is complete." },
  on_hold: { label: "Paused", description: "This work is paused. Your contact will be in touch." },
  cancelled: { label: "Cancelled", description: "This engagement was cancelled." },
  closed: { label: "Complete", description: "This engagement is complete." },
};

export const CLIENT_TYPE_LABELS: Record<ClientType, string> = {
  individual: "Individual",
  household: "Household",
  business: "Business",
};

export const CLIENT_STATUS_LABELS: Record<ClientStatus, string> = {
  prospect: "Prospect",
  onboarding: "Onboarding",
  active: "Active",
  inactive: "Inactive",
  on_hold: "On hold",
  former: "Former client",
};

export const ONBOARDING_STATUS_LABELS: Record<"not_started" | "information_requested" | "awaiting_documents" | "under_verification" | "completed", string> = {
  not_started: "Not started",
  information_requested: "Information requested",
  awaiting_documents: "Awaiting documents",
  under_verification: "Under verification",
  completed: "Completed",
};

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Admin",
  manager: "Manager",
  employee: "Employee",
  read_only: "Read only",
  client: "Client",
};

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new: "New",
  contacted: "Contacted",
  qualified: "Qualified",
  consultation_scheduled: "Consultation scheduled",
  proposal_sent: "Proposal sent",
  negotiation: "Negotiation",
  converted: "Won / Converted",
  lost: "Lost",
  nurture: "Nurture",
};

export const PRIORITY_LABELS: Record<"low" | "normal" | "high" | "urgent", string> = { low: "Low", normal: "Normal", high: "High", urgent: "Urgent" };

export const TASK_STATUS_LABELS: Record<"todo" | "in_progress" | "waiting_client" | "waiting_review" | "blocked" | "completed" | "cancelled", string> = {
  todo: "To do",
  in_progress: "In progress",
  waiting_client: "Waiting for client",
  waiting_review: "Waiting for internal review",
  blocked: "Blocked",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const PROPOSAL_STATUS_LABELS: Record<"not_required" | "draft" | "sent" | "accepted" | "declined", string> = {
  not_required: "Not required",
  draft: "Draft",
  sent: "Sent",
  accepted: "Accepted",
  declined: "Declined",
};

export const BILLING_FREQUENCY_LABELS: Record<"one_time" | "monthly" | "quarterly" | "annually" | "hourly", string> = {
  one_time: "One-time fee",
  monthly: "Monthly",
  quarterly: "Quarterly",
  annually: "Annually",
  hourly: "Hourly",
};

export const CONTACT_ROLE_LABELS: Record<"owner" | "primary" | "billing" | "authorized_representative" | "other", string> = {
  owner: "Business owner",
  primary: "Primary contact",
  billing: "Billing contact",
  authorized_representative: "Authorized representative",
  other: "Other",
};

export const ACTIVITY_TYPE_LABELS: Record<"note" | "call" | "email" | "meeting" | "comment" | "internal_note" | "assignment" | "status_change" | "system", string> = {
  note: "Note",
  call: "Call",
  email: "Email",
  meeting: "Meeting",
  comment: "Comment",
  internal_note: "Internal note",
  assignment: "Assignment",
  status_change: "Status change",
  system: "Update",
};

/** Display numbers: L-0001, C-0001, E-0001, T-0001. */
export function recordNumber(prefix: "L" | "C" | "E" | "T", n: number | null | undefined): string | null {
  return n ? `${prefix}-${String(n).padStart(4, "0")}` : null;
}

export const LEAD_SOURCE_LABELS: Record<"website" | "referral" | "phone" | "walk_in" | "other", string> = {
  website: "Website form",
  referral: "Referral",
  phone: "Phone call",
  walk_in: "Walk-in",
  other: "Other",
};

export const APPOINTMENT_KIND_LABELS: Record<"in_person" | "phone" | "video" | "internal", string> = {
  in_person: "In person",
  phone: "Phone call",
  video: "Video call",
  internal: "Internal",
};

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
}

export const INVOICE_STATUS_LABELS: Record<"draft" | "sent" | "partially_paid" | "paid" | "cancelled" | "refunded", string> = {
  draft: "Draft (not sent)",
  sent: "Awaiting payment",
  partially_paid: "Partially paid",
  paid: "Paid",
  cancelled: "Cancelled",
  refunded: "Refunded",
};

/** 125050 → "$1,250.50" (amounts are stored as integer cents). */
export function formatMoney(cents: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}
