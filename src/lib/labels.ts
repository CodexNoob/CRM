import type { ClientStatus, ClientType, EngagementStatus, ServiceType, UserRole } from "@/db/schema";

export const SERVICE_LABELS: Record<ServiceType, string> = {
  individual_tax: "Individual tax return",
  business_tax: "Business tax return",
  tax_consulting: "Tax consulting",
  bookkeeping: "Bookkeeping",
  accounting: "Accounting",
  other: "Other",
};

export const STATUS_LABELS: Record<EngagementStatus, string> = {
  not_started: "Not started",
  waiting_on_client: "Waiting on client",
  in_progress: "In progress",
  in_review: "In review",
  ready_to_file: "Ready to file",
  filed: "Filed",
  completed: "Completed",
  on_hold: "On hold",
};

/** Plain-language status for clients. Deliberately reveals no internal detail. */
export const PORTAL_STATUS: Record<EngagementStatus, { label: string; description: string }> = {
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
};

export const CLIENT_TYPE_LABELS: Record<ClientType, string> = {
  individual: "Individual",
  household: "Household",
  business: "Business",
};

export const CLIENT_STATUS_LABELS: Record<ClientStatus, string> = {
  prospect: "Prospect",
  active: "Active",
  inactive: "Inactive",
};

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Firm admin",
  partner: "Partner / reviewer",
  preparer: "Preparer",
  client: "Client",
};

export const LEAD_STATUS_LABELS: Record<"new" | "contacted" | "qualified" | "converted" | "lost", string> = {
  new: "New",
  contacted: "Contacted",
  qualified: "Qualified",
  converted: "Converted",
  lost: "Lost",
};

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
