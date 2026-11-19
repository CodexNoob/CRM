import type { NavIconName } from "./icons";
import type { Actor } from "@/lib/auth/actor";
import { canManageTeam } from "@/lib/auth/actor";
import { can, type Module } from "@/lib/auth/permissions";

/**
 * The staff sidebar. `live` items open working pages. `planned` items open an
 * honest "planned" page under /crm/<slug> describing what the module will do;
 * when a module is built, give it a real page and flip it to `live`.
 */

export interface NavEntry {
  slug: string;
  href: string;
  label: string;
  icon: NavIconName;
  status: "live" | "planned";
  adminOnly?: boolean;
  superAdminOnly?: boolean;
  module?: Module;
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
  slug, href: `/crm/${slug}`, label, icon, summary, status: "planned", ...extra,
});

export const NAV_SECTIONS: NavSection[] = [
  {
    title: "Workspace",
    items: [
      live("dashboard", "/crm", "Dashboard", "dashboard", "KPIs, upcoming deadlines, tasks, recent activity"),
      live("clients", "/crm/clients", "Clients", "clients", "Individual and business client records"),
      live("leads", "/crm/leads", "Leads & Prospects", "leads", "New inquiries, lead pipeline, follow-ups", { badge: "newLeads" }),
      live("engagements", "/crm/engagements", "Projects & Engagements", "engagements", "Tax filing projects, bookkeeping engagements"),
      live("tasks", "/crm/tasks", "Tasks & Workflows", "tasks", "Assignments, recurring tasks, workflow stages", { badge: "myOpenTasks" }),
    ],
  },
  {
    title: "Tax & Accounting",
    items: [
      live("tax-returns", "/crm/tax-returns", "Tax Returns", "returns", "Tax return records, filing status, tax year"),
      live("tax-preparation", "/crm/tax-preparation", "Tax Preparation", "preparation", "Preparation, review, approval, completion"),
      live("bookkeeping", "/crm/bookkeeping", "Bookkeeping", "bookkeeping", "Monthly bookkeeping and accounting work"),
      live("calendar", "/crm/calendar", "Deadlines & Calendar", "calendar", "Tax deadlines, appointments, reminders"),
    ],
  },
  {
    title: "Client Collaboration",
    items: [
      live("documents", "/crm/documents", "Documents", "documents", "Uploads, folders, document requests"),
      live("messages", "/crm/messages", "Messages", "messages", "Secure client communication", { badge: "unreadMessages" }),
      // Configured firms can use the dashboard to run admin-only test requests before live enablement.
      process.env.DROPBOX_SIGN_API_KEY?.trim()
        ? live("e-signatures", "/crm/e-signatures", "E-Signatures", "esign", "Engagement letters and signature requests via Dropbox Sign")
        : planned("e-signatures", "E-Signatures", "esign", "Engagement letters and signature requests", { needs: "Connect the Dropbox Sign provider with a server-side API key. Documents are sent for signature and signed on Dropbox Sign; the signed copy and its audit trail are stored here. Signatures are never captured or simulated inside this app." }),
      live("client-portal", "/crm/client-portal", "Client Portal", "portal", "Client-facing portal management"),
    ],
  },
  {
    title: "Financial Management",
    items: [
      live("invoices", "/crm/invoices", "Invoices & Billing", "invoices", "Create QuickBooks invoices and track payment status", { module: "billing" }),
      planned("payments", "Payments", "payments", "Payment status and transaction history", { module: "billing", needs: "Invoice payment status is synced from QuickBooks on Invoices & Billing. This page may add a consolidated transaction history from QuickBooks reporting." }),
      live("reports", "/crm/reports", "Financial Reports", "reports", "Revenue, outstanding balances", { module: "reports" }),
      live("integrations", "/crm/integrations", "Integrations", "integrations", "QuickBooks Online and other integrations", { module: "integrations" }),
    ],
  },
  {
    title: "Administration",
    items: [
      live("team", "/crm/team", "Team Members", "team", "Staff accounts and assignments", { adminOnly: true, module: "team" }),
      planned("automation", "Automation Rules", "automation", "Automated reminders and workflows", { adminOnly: true, module: "team", needs: "A background job runner and an email service, so reminders can be sent on schedule even when no one is signed in." }),
      live("activity", "/crm/activity", "Activity Logs", "activity", "Audit trail and user activities", { adminOnly: true, module: "team" }),
      live("settings", "/crm/settings", "Organization Settings", "settings", "Private firm profile, client announcements and security", { adminOnly: true, module: "settings" }),
      live("platform-settings", "/crm/platform-settings", "Platform Settings", "settings", "Platform identity and platform-only inquiries", { superAdminOnly: true }),
    ],
  },
];

export function navForRole(actor: Pick<Actor, "role">): NavSection[] {
  return NAV_SECTIONS.map((s) => ({
    ...s,
    items: s.items.filter((i) =>
      (i.module !== "billing" || actor.role === "admin")
      &&
      (!i.adminOnly || canManageTeam(actor))
      && (!i.superAdminOnly || actor.role === "super_admin")
      && (!i.module || can(actor, i.module, "view")),
    ),
  })).filter((s) => s.items.length > 0);
}

export function findPlanned(slug: string): NavEntry | undefined {
  return NAV_SECTIONS.flatMap((s) => s.items).find((i) => i.slug === slug && i.status === "planned");
}
