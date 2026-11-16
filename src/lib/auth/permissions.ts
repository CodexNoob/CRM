import type { Actor } from "./actor";

/**
 * Granular permissions, defined in ONE place and checked on the server by every service
 * (the UI uses the same table only to hide controls; it is never the gate).
 *
 * Record-level scoping is separate and still applies on top: everyone is limited to their
 * own firm, and employees to the clients they are assigned to (see services/access.ts).
 */

export type Module =
  | "leads"
  | "clients"
  | "engagements"
  | "tasks"
  | "templates"
  | "billing"
  | "team"
  | "settings"
  | "reports"
  | "tax_preparation"
  | "tax_returns"
  | "bookkeeping"
  | "calendar"
  | "integrations"
  | "documents"
  | "messages"
  | "esignatures"
  | "client_portal";
export type Action =
  | "view" | "create" | "edit" | "delete" | "assign" | "export" | "approve" | "manage"
  | "file" | "post" | "reconcile" | "close_period" | "reopen_period"
  // Client collaboration
  | "upload" | "download" | "request" | "review" | "verify" | "reject" | "share" | "archive"
  | "reply" | "close" | "internal_note"
  | "send" | "void"
  | "manage_access" | "invite_client" | "suspend_access" | "manage_contacts";

type Matrix = Partial<Record<Module, readonly Action[]>>;

const ALL: readonly Action[] = [
  "view", "create", "edit", "delete", "assign", "export", "approve", "manage", "file", "post", "reconcile", "close_period", "reopen_period",
  "upload", "download", "request", "review", "verify", "reject", "share", "archive", "reply", "close", "internal_note", "send", "void",
  "manage_access", "invite_client", "suspend_access", "manage_contacts",
];

const ROLE_PERMISSIONS: Record<Actor["role"], Matrix> = {
  super_admin: {
    leads: ALL, clients: ALL, engagements: ALL, tasks: ALL, templates: ALL, billing: ALL, team: ALL, settings: ALL, reports: ALL,
    tax_preparation: ALL, tax_returns: ALL, bookkeeping: ALL, calendar: ALL, integrations: ["view"],
    documents: ALL, messages: ALL, esignatures: ALL, client_portal: ALL,
  },
  admin: {
    leads: ALL, clients: ALL, engagements: ALL, tasks: ALL, templates: ALL, billing: ALL, team: ALL, settings: ALL, reports: ALL,
    tax_preparation: ALL, tax_returns: ALL, bookkeeping: ALL, calendar: ALL, integrations: ["view"],
    documents: ALL, messages: ALL, esignatures: ALL, client_portal: ALL,
  },
  // Managers run the practice: approvals, assignment, closing engagements, templates. No firm settings or team admin.
  manager: {
    leads: ["view", "create", "edit", "assign", "export", "approve"],
    clients: ["view", "create", "edit", "assign", "export", "approve"],
    engagements: ["view", "create", "edit", "assign", "export", "approve", "manage"],
    tasks: ["view", "create", "edit", "assign", "export", "approve"],
    templates: ["view", "create", "edit", "manage"],
    billing: ["view", "create", "edit"],
    reports: ["view", "export"],
    integrations: ["view"],
    tax_preparation: ["view", "create", "edit", "assign", "approve", "manage"],
    tax_returns: ["view", "create", "edit", "assign", "approve", "file", "manage"],
    bookkeeping: ["view", "create", "edit", "assign", "approve", "manage", "post", "reconcile", "close_period", "reopen_period"],
    calendar: ["view", "create", "edit", "delete", "assign", "manage"],
    documents: ["view", "upload", "edit", "download", "request", "review", "verify", "reject", "share", "archive"],
    messages: ["view", "create", "reply", "assign", "close", "internal_note", "manage"],
    esignatures: ["view", "create", "send", "void"],
    client_portal: ["view", "manage_access", "invite_client", "suspend_access", "manage_contacts"],
  },
  // Employees do the work on the clients assigned to them. No approvals, deletes or exports.
  employee: {
    leads: ["view", "create", "edit"],
    clients: ["view", "create", "edit"],
    engagements: ["view", "create", "edit"],
    tasks: ["view", "create", "edit"],
    templates: ["view"],
    billing: ["view", "create"],
    reports: ["view"],
    integrations: ["view"],
    tax_preparation: ["view", "create", "edit"],
    tax_returns: ["view", "create", "edit", "approve"],
    bookkeeping: ["view", "create", "edit"],
    calendar: ["view", "create", "edit"],
    // Employees review documents but verification/rejection is a reviewer (manager) decision.
    documents: ["view", "upload", "edit", "download", "request", "review", "share"],
    messages: ["view", "create", "reply", "close", "internal_note"],
    esignatures: ["view", "create"],
    client_portal: ["view", "invite_client"],
  },
  // Auditors / observers: see everything in the firm, change nothing. Billing is excluded on purpose.
  read_only: {
    leads: ["view"], clients: ["view"], engagements: ["view"], tasks: ["view"], templates: ["view"], reports: ["view"], integrations: ["view"],
    tax_preparation: ["view"], tax_returns: ["view"], bookkeeping: ["view"], calendar: ["view"],
    // Read-only users see that documents/messages exist but may not download file contents.
    documents: ["view"], messages: ["view"], esignatures: ["view"], client_portal: ["view"],
  },
  // Portal users never receive staff permissions; their access is resolved per client in services/portal-access.ts.
  client: {},
};

export function can(actor: Pick<Actor, "role">, module: Module, action: Action): boolean {
  return ROLE_PERMISSIONS[actor.role]?.[module]?.includes(action) ?? false;
}

/** Everything one role may do, for the UI (hide buttons the server would refuse anyway). */
export function permissionsFor(actor: Pick<Actor, "role">): Record<Module, Action[]> {
  const m = ROLE_PERMISSIONS[actor.role] ?? {};
  return Object.fromEntries(
    (["leads", "clients", "engagements", "tasks", "templates", "billing", "team", "settings", "reports", "tax_preparation", "tax_returns", "bookkeeping", "calendar", "integrations", "documents", "messages", "esignatures", "client_portal"] as Module[])
      .map((k) => [k, [...(m[k] ?? [])]]),
  ) as Record<Module, Action[]>;
}
