/**
 * Display labels and tones for document management (client-safe: no imports with side effects).
 * Kept with the documents module so the module owns its vocabulary.
 */
import type { DocumentCategory, DocumentStatus, DocumentVisibility } from "@/db/schema";

export const DOCUMENT_CATEGORY_LABELS: Record<DocumentCategory, string> = {
  tax_documents: "Tax documents",
  income_statements: "Income statements",
  bank_statements: "Bank statements",
  financial_reports: "Financial reports",
  expense_receipts: "Expense receipts",
  invoices: "Invoices",
  contracts: "Contracts",
  engagement_letters: "Engagement letters",
  tax_returns: "Tax returns",
  identity_documents: "Identity documents",
  payroll_documents: "Payroll documents",
  bookkeeping_records: "Bookkeeping records",
  other: "Other",
};

export const DOCUMENT_STATUS_LABELS: Record<DocumentStatus, string> = {
  requested: "Requested",
  uploaded: "Uploaded",
  under_review: "Under review",
  verified: "Verified",
  rejected: "Rejected",
  replacement_requested: "Replacement requested",
  archived: "Archived",
};

/** What clients see (plain language). */
export const PORTAL_DOCUMENT_STATUS_LABELS: Record<DocumentStatus, string> = {
  requested: "Requested",
  uploaded: "Received",
  under_review: "Being reviewed",
  verified: "Accepted",
  rejected: "Not accepted",
  replacement_requested: "Please send a new copy",
  archived: "Archived",
};

export const DOCUMENT_STATUS_TONE: Record<DocumentStatus, "neutral" | "info" | "brand" | "good" | "danger" | "warn"> = {
  requested: "neutral",
  uploaded: "info",
  under_review: "brand",
  verified: "good",
  rejected: "danger",
  replacement_requested: "warn",
  archived: "neutral",
};

export const DOCUMENT_VISIBILITY_LABELS: Record<DocumentVisibility, string> = {
  internal_only: "Internal only",
  client_visible: "Client visible",
  shared_with_client: "Shared with client",
};

export const REQUEST_STATUS_LABELS: Record<"draft" | "sent" | "partially_fulfilled" | "fulfilled" | "overdue" | "cancelled", string> = {
  draft: "Draft",
  sent: "Sent",
  partially_fulfilled: "Partially fulfilled",
  fulfilled: "Fulfilled",
  overdue: "Overdue",
  cancelled: "Cancelled",
};

export const REQUEST_STATUS_TONE: Record<keyof typeof REQUEST_STATUS_LABELS, "neutral" | "info" | "brand" | "good" | "danger" | "warn"> = {
  draft: "neutral",
  sent: "info",
  partially_fulfilled: "brand",
  fulfilled: "good",
  overdue: "danger",
  cancelled: "neutral",
};

export const REQUEST_ITEM_STATUS_LABELS: Record<"pending" | "uploaded" | "under_review" | "verified" | "rejected" | "replacement_requested" | "waived", string> = {
  pending: "Waiting for file",
  uploaded: "Uploaded",
  under_review: "Under review",
  verified: "Verified",
  rejected: "Rejected",
  replacement_requested: "Replacement requested",
  waived: "Not needed",
};

export const REQUEST_ITEM_STATUS_TONE: Record<keyof typeof REQUEST_ITEM_STATUS_LABELS, "neutral" | "info" | "brand" | "good" | "danger" | "warn"> = {
  pending: "neutral",
  uploaded: "info",
  under_review: "brand",
  verified: "good",
  rejected: "danger",
  replacement_requested: "warn",
  waived: "neutral",
};

export const recordDocNumber = (n: number | null | undefined) => (n ? `D-${String(n).padStart(4, "0")}` : null);
export const recordRequestNumber = (n: number | null | undefined) => (n ? `R-${String(n).padStart(4, "0")}` : null);
