/**
 * The software product sold to firms (the home page, sign-up and subscription pages).
 * Change the name and prices here. CRM subscriptions are billed through PayPal.
 *
 * TODO(owner): replace PRODUCT name with the real product name before launch.
 */

export const product = {
  name: process.env.NEXT_PUBLIC_PRODUCT_NAME || "Personal CRM",
  tagline: "The personal CRM for tax and accounting firms.",
  description:
    "Clients, engagements, deadlines, documents, secure messaging, a client portal and billing in one place, built for U.S. tax and accounting firms.",
  trialDays: 14,
  currency: "USD",
  plans: {
    month: { label: "Monthly", amountCents: 9900, per: "month", note: "Billed every month. Cancel anytime." },
    year: { label: "Yearly", amountCents: 99000, per: "year", note: "Billed once a year - 2 months free." },
  },
  /** Every plan includes everything; the price is per firm. */
  included: [
    "Unlimited staff and clients",
    "Client portal with secure document upload",
    "Engagements, tasks and deadline calendar",
    "Secure client messaging",
    "Website inquiry form and lead pipeline",
    "Invoices and recurring client billing through QuickBooks Online",
    "Activity logs and role-based access",
  ],
  features: [
    { title: "Every client in one place", body: "Individuals, households and businesses, with their engagements, documents, messages and billing on one record." },
    { title: "Deadlines you won’t miss", body: "Tax-return and bookkeeping work with due dates, tasks and a firm-wide calendar." },
    { title: "A portal clients actually use", body: "Clients follow progress, see what you need, upload W-2s and 1099s securely and message you — no more email attachments." },
    { title: "Get paid faster", body: "Send QuickBooks invoices and schedule recurring invoice billing without storing payment credentials." },
    { title: "Lead management", body: "Capture inquiries, track follow-ups and convert prospects inside your private workspace." },
    { title: "Security first", body: "Role-based access, private workspaces per firm, audit logs, and no card data stored in the app." },
  ],
} as const;

export type PlanInterval = keyof typeof product.plans;
export const PLAN_INTERVALS = Object.keys(product.plans) as PlanInterval[];
