/**
 * Public website content. Edit this file to update the firm's details, services
 * and announcements; the home page and search-engine metadata read from it.
 *
 * TODO(firm): every value marked PLACEHOLDER must be replaced with real details
 * before the site goes live. Do not add testimonials, credentials or statistics
 * unless they are real and verifiable.
 */

export const site = {
  name: "Personal Project",
  shortName: "MY",
  tagline: "Tax preparation, consulting and accounting for individuals and businesses.",
  heroBadge: "Now booking for the 2027 filing season",
  /** Short claims under the hero. Keep each one true for the firm. */
  highlights: ["Individuals and businesses", "Clear, upfront engagement terms", "Progress you can follow online", "Year-round support"],
  description:
    "Individual and business tax preparation, tax consulting, bookkeeping and accounting, with a secure client portal to follow your work from start to finish.",
  contact: {
    phone: "+63 919 762 1060",
    email: "charlesjohnduot@gmail.com",
    addressLines: ["Kasiglahan, San Jose", "Rodriguez, Rizal, Philippines"],
    hours: [
      ["Monday – Friday", "9:00 AM – 5:00 PM"],
      ["Saturday (Feb – Apr)", "By appointment"],
    ] as [string, string][], // PLACEHOLDER
  },
} as const;

export type ServiceIcon = "person" | "building" | "lightbulb" | "ledger" | "chart";

export const services: { title: string; description: string; icon: ServiceIcon; points: string[] }[] = [
  {
    title: "Individual tax preparation",
    description: "Accurate federal and state returns, prepared and reviewed with care.",
    icon: "person",
    points: ["W-2, self-employment and investment income", "Deductions and credits reviewed", "E-file with status updates"],
  },
  {
    title: "Business tax preparation",
    description: "Returns for sole proprietors, partnerships, S corporations and C corporations.",
    icon: "building",
    points: ["Schedule C, 1065, 1120-S, 1120", "Estimated tax planning", "Year-end close support"],
  },
  {
    title: "Tax consulting",
    description: "Advice before decisions are made, not just after the year ends.",
    icon: "lightbulb",
    points: ["Life and business changes", "Entity selection", "IRS and state notices"],
  },
  {
    title: "Bookkeeping",
    description: "Clean, reconciled books every month, so tax time is no surprise.",
    icon: "ledger",
    points: ["Monthly reconciliation", "QuickBooks Online setup and cleanup", "Clear monthly reports"],
  },
  {
    title: "Accounting",
    description: "Financial statements and reporting that help you run the business.",
    icon: "chart",
    points: ["Financial statements", "Payroll coordination", "Budgeting and cash flow"],
  },
];

export const steps: { title: string; body: string }[] = [
  { title: "Get in touch", body: "Call or email us. We’ll learn what you need and confirm the right service." },
  { title: "Sign your engagement", body: "We agree on scope and fees up front, so there are no surprises." },
  { title: "Share your information", body: "Your portal checklist shows exactly what we need from you." },
  { title: "We prepare and file", body: "Follow progress in the portal. We contact you if anything else is needed." },
];

/** Newest first. Set to [] to hide the section. */
export const announcements: { date: string; title: string; body: string }[] = [
  {
    date: "2026-11-11", // PLACEHOLDER
    title: "Now scheduling for the 2027 filing season",
    body: "Returning and new clients can book a preparation appointment now. Earlier appointments mean earlier refunds.", // PLACEHOLDER
  },
];
