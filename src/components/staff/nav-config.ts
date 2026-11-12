import type { NavIconName } from "./icons";

/**
 * The staff sidebar. `live` items open working pages. `planned` items open an
 * honest "planned" page under /staff/<slug> describing what the module will do;
 * when a module is built, give it a real page and flip it to `live`.
 */

export interface NavEntry {
  slug: string;
  href: string;
  label: string;
  icon: NavIconName;
  status: "live" | "planned";
  adminOnly?: boolean;
  /** What the module does (shown on its planned page). */
  summary: string;
  /** Badge key filled with a real count by the layout. */
  badge?: "myOpenTasks" | "newLeads" | "unreadMessages";
  /** For planned modules: what must exist before it can be built honestly. */
  needs?: string;
}

export interface NavSection {
  title: string;
  items: NavEntry[];
}

const live = (slug: string, href: string, label: string, icon: NavIconName, summary: string, extra: Partial<NavEntry> = {}): NavEntry => ({
  slug, href, label, icon, summary, status: "live", ...extra,
});
const planned = (slug: string, label: string, icon: NavIconName, summary: string, extra: Partial<NavEntry> = {}): NavEntry => ({
  slug, href: `/staff/${slug}`, label, icon, summary, status: "planned", ...extra,
});

export const NAV_SECTIONS: NavSection[] = [
  {
    title: "Workspace",
    items: [
      live("dashboard", "/staff", "Dashboard", "dashboard", "KPIs, upcoming deadlines, tasks, recent activity"),
      live("clients", "/staff/clients", "Clients", "clients", "Individual and business client records"),
      live("leads", "/staff/leads", "Leads & Prospects", "leads", "New inquiries, lead pipeline, follow-ups", { badge: "newLeads" }),
      live("engagements", "/staff/engagements", "Projects & Engagements", "engagements", "Tax filing projects, bookkeeping engagements"),
      live("tasks", "/staff/tasks", "Tasks & Workflows", "tasks", "Assignments, recurring tasks, workflow stages", { badge: "myOpenTasks" }),
    ],
  },
  {
    title: "Tax & Accounting",
    items: [
      live("tax-returns", "/staff/tax-returns", "Tax Returns", "returns", "Tax return records, filing status, tax year"),
      live("tax-preparation", "/staff/tax-preparation", "Tax Preparation", "preparation", "Preparation, review, approval, completion"),
      live("bookkeeping", "/staff/bookkeeping", "Bookkeeping", "bookkeeping", "Monthly bookkeeping and accounting work"),
      live("calendar", "/staff/calendar", "Deadlines & Calendar", "calendar", "Tax deadlines, appointments, reminders"),
    ],
  },
  {
    title: "Client Collaboration",
    items: [
      live("documents", "/staff/documents", "Documents", "documents", "Uploads, folders, document requests"),
      live("messages", "/staff/messages", "Messages", "messages", "Secure client communication", { badge: "unreadMessages" }),
      // E-signatures stay "Soon" until Dropbox Sign is connected AND the firm has enabled it after testing.
      process.env.DROPBOX_SIGN_ENABLED === "1" && !!process.env.DROPBOX_SIGN_API_KEY?.trim()
        ? live("e-signatures", "/staff/e-signatures", "E-Signatures", "esign", "Engagement letters and signature requests via Dropbox Sign")
        : planned("e-signatures", "E-Signatures", "esign", "Engagement letters and signature requests", { needs: "Connecting the Dropbox Sign e-signature provider (API key + webhook) and a successful test. Documents are sent for signature and signed on Dropbox Sign; the signed copy and its audit trail are stored here. Signatures are never captured or simulated inside this app." }),
      live("client-portal", "/staff/client-portal", "Client Portal", "portal", "Client-facing portal management"),
    ],
  },
  {
    title: "Financial Management",
    items: [
      live("invoices", "/staff/invoices", "Invoices & Billing", "invoices", "Create invoices, send them through PayPal and track payment"),
      planned("payments", "Payments", "payments", "Payment status and transaction history", { needs: "Invoice payments are already tracked on Invoices & Billing (via PayPal). This page will add a full transaction history (payouts, fees and refunds) from PayPal’s reporting API. Card details will never be stored in this app." }),
      live("reports", "/staff/reports", "Financial Reports", "reports", "Revenue, outstanding balances"),
      live("integrations", "/staff/integrations", "Integrations", "integrations", "QuickBooks Online and other integrations"),
    ],
  },
  {
    title: "Administration",
    items: [
      live("team", "/staff/team", "Team Members", "team", "Staff accounts and assignments", { adminOnly: true }),
      planned("automation", "Automation Rules", "automation", "Automated reminders and workflows", { adminOnly: true, needs: "A background job runner and an email service, so reminders can be sent on schedule even when no one is signed in." }),
      live("activity", "/staff/activity", "Activity Logs", "activity", "Audit trail and user activities", { adminOnly: true }),
      live("settings", "/staff/settings", "Settings", "settings", "Firm profile, permissions, security", { adminOnly: true }),
    ],
  },
];

export function navForRole(isAdmin: boolean): NavSection[] {
  return NAV_SECTIONS.map((s) => ({ ...s, items: s.items.filter((i) => isAdmin || !i.adminOnly) })).filter((s) => s.items.length > 0);
}

export function findPlanned(slug: string): NavEntry | undefined {
  return NAV_SECTIONS.flatMap((s) => s.items).find((i) => i.slug === slug && i.status === "planned");
}
