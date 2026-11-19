import type { Actor } from "./actor";

/**
 * Server-checked permissions. Client visibility is additionally scoped by firm and
 * assignment in services/access.ts.
 */
export type Module =
  | "leads" | "clients" | "engagements" | "tasks" | "templates" | "billing" | "team" | "settings" | "reports"
  | "tax_preparation" | "tax_returns" | "bookkeeping" | "calendar" | "integrations" | "documents" | "messages"
  | "esignatures" | "client_portal";
export type Action =
  | "view" | "create" | "edit" | "delete" | "assign" | "export" | "approve" | "manage"
  | "file" | "post" | "reconcile" | "close_period" | "reopen_period"
  | "upload" | "download" | "request" | "review" | "verify" | "reject" | "share" | "archive"
  | "reply" | "close" | "internal_note" | "send" | "void"
  | "manage_access" | "invite_client" | "suspend_access" | "manage_contacts";
type Matrix = Partial<Record<Module, readonly Action[]>>;

const ALL: readonly Action[] = [
  "view", "create", "edit", "delete", "assign", "export", "approve", "manage", "file", "post", "reconcile", "close_period", "reopen_period",
  "upload", "download", "request", "review", "verify", "reject", "share", "archive", "reply", "close", "internal_note", "send", "void",
  "manage_access", "invite_client", "suspend_access", "manage_contacts",
];
const OWNER: Matrix = {
  leads: ALL, clients: ALL, engagements: ALL, tasks: ALL, templates: ALL, billing: ALL, team: ALL, settings: ALL, reports: ALL,
  tax_preparation: ALL, tax_returns: ALL, bookkeeping: ALL, calendar: ALL, integrations: ["view"], documents: ALL, messages: ALL, esignatures: ALL, client_portal: ALL,
};
const ADMINISTRATOR: Matrix = {
  ...OWNER,
  // Firm ownership, subscription and security configuration remain with Owner.
  billing: [],
  settings: ["view", "edit"],
  integrations: ["view"],
};
const OPERATIONS_MANAGER: Matrix = {
  leads: ["view", "create", "edit", "assign", "export", "approve"],
  clients: ["view", "create", "edit", "assign", "export", "approve"],
  engagements: ["view", "create", "edit", "assign", "export", "approve", "manage"],
  tasks: ["view", "create", "edit", "assign", "export", "approve"],
  templates: ["view", "create", "edit", "manage"], reports: ["view", "export"], integrations: ["view"],
  tax_preparation: ["view", "create", "edit", "assign", "approve", "manage"],
  tax_returns: ["view", "create", "edit", "assign", "approve", "file", "manage"],
  bookkeeping: ["view", "create", "edit", "assign", "approve", "manage", "post", "reconcile", "close_period", "reopen_period"],
  calendar: ["view", "create", "edit", "delete", "assign", "manage"],
  documents: ["view", "upload", "edit", "download", "request", "review", "verify", "reject", "share", "archive"],
  messages: ["view", "create", "reply", "assign", "close", "internal_note", "manage"], esignatures: ["view", "create", "send", "void"],
  client_portal: ["view", "manage_access", "invite_client", "suspend_access", "manage_contacts"],
};
const PROJECT_MANAGER: Matrix = {
  ...OPERATIONS_MANAGER,
  // Project managers run client delivery and teams without managing firm wide intake/settings.
  leads: ["view"], clients: ["view", "edit"], templates: ["view"],
  tax_returns: ["view", "create", "edit", "approve"], bookkeeping: ["view", "create", "edit", "approve", "post", "reconcile"],
};
const EMPLOYEE: Matrix = {
  leads: ["view", "create", "edit"], clients: ["view", "edit"], engagements: ["view", "create", "edit"], tasks: ["view", "create", "edit"],
  templates: ["view"], reports: ["view"], integrations: ["view"],
  tax_preparation: ["view", "create", "edit"], tax_returns: ["view", "create", "edit"], bookkeeping: ["view", "create", "edit"],
  calendar: ["view", "create", "edit"], documents: ["view", "upload", "edit", "download", "request", "review", "share"],
  messages: ["view", "create", "reply", "close", "internal_note"], esignatures: ["view", "create"], client_portal: ["view", "invite_client"],
};
const SALES_REP: Matrix = {
  leads: ["view", "create", "edit", "assign", "export"], clients: ["view", "create", "edit"], engagements: ["view", "create"],
  tasks: ["view", "create", "edit"], reports: ["view"], calendar: ["view", "create", "edit"],
  documents: ["view", "upload", "download", "share"], messages: ["view", "create", "reply", "close"], client_portal: ["view", "invite_client"],
};
const SALES_MANAGER: Matrix = {
  ...SALES_REP,
  leads: ["view", "create", "edit", "assign", "export", "approve", "manage"],
  clients: ["view", "create", "edit", "assign", "export"], engagements: ["view", "create", "edit", "assign"],
  reports: ["view", "export"],
};
const FINANCE: Matrix = {
  clients: ["view"], engagements: ["view"], tasks: ["view", "create", "edit"],
  reports: ["view", "export"], tax_returns: ["view", "create", "edit", "approve", "file"],
  bookkeeping: ["view", "create", "edit", "approve", "post", "reconcile", "close_period"], calendar: ["view"],
  documents: ["view", "download", "upload", "request", "review"], messages: ["view", "reply"],
};
const ACCOUNTANT: Matrix = {
  ...FINANCE,
  billing: [],
  tax_returns: ["view", "create", "edit"],
  bookkeeping: ["view", "create", "edit", "post", "reconcile"],
};
const ACCOUNT_MANAGER: Matrix = {
  clients: ["view", "edit"], engagements: ["view"], tasks: ["view", "create", "edit"], reports: ["view"], calendar: ["view", "create", "edit"],
  documents: ["view", "upload", "download", "request", "share"], messages: ["view", "create", "reply", "close", "internal_note"], client_portal: ["view", "invite_client", "manage_contacts"],
};
const SUPPORT: Matrix = {
  clients: ["view"], engagements: ["view"], tasks: ["view", "create", "edit"], calendar: ["view", "create", "edit"],
  documents: ["view", "upload", "download", "request"], messages: ["view", "create", "reply", "close"], client_portal: ["view", "invite_client"],
};
const MARKETING: Matrix = {
  leads: ["view", "create", "edit", "export"], clients: ["view"], reports: ["view", "export"], calendar: ["view"],
};
const READ_ONLY: Matrix = {
  leads: ["view"], clients: ["view"], engagements: ["view"], tasks: ["view"], templates: ["view"], reports: ["view"], integrations: ["view"],
  tax_preparation: ["view"], tax_returns: ["view"], bookkeeping: ["view"], calendar: ["view"], documents: ["view"], messages: ["view"], esignatures: ["view"], client_portal: ["view"],
};

const ROLE_PERMISSIONS: Record<Actor["role"], Matrix> = {
  super_admin: { ...OWNER, billing: [] }, admin: OWNER, administrator: ADMINISTRATOR,
  operations_manager: OPERATIONS_MANAGER, manager: OPERATIONS_MANAGER, project_manager: PROJECT_MANAGER,
  team_member: EMPLOYEE, employee: EMPLOYEE, sales_manager: SALES_MANAGER, sales_representative: SALES_REP,
  finance_manager: FINANCE, accountant: ACCOUNTANT, marketing_manager: MARKETING,
  account_manager: ACCOUNT_MANAGER, support_agent: SUPPORT, developer: {}, read_only: READ_ONLY, client: {},
};

export function can(actor: Pick<Actor, "role">, module: Module, action: Action): boolean {
  return ROLE_PERMISSIONS[actor.role]?.[module]?.includes(action) ?? false;
}

export function permissionsFor(actor: Pick<Actor, "role">): Record<Module, Action[]> {
  const m = ROLE_PERMISSIONS[actor.role] ?? {};
  return Object.fromEntries(
    (["leads", "clients", "engagements", "tasks", "templates", "billing", "team", "settings", "reports", "tax_preparation", "tax_returns", "bookkeeping", "calendar", "integrations", "documents", "messages", "esignatures", "client_portal"] as Module[])
      .map((k) => [k, [...(m[k] ?? [])]]),
  ) as Record<Module, Action[]>;
}
