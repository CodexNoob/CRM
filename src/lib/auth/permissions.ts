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
  | "calendar";
export type Action = "view" | "create" | "edit" | "delete" | "assign" | "export" | "approve" | "manage" | "file" | "post" | "reconcile" | "close_period" | "reopen_period";

type Matrix = Partial<Record<Module, readonly Action[]>>;

const ALL: readonly Action[] = ["view", "create", "edit", "delete", "assign", "export", "approve", "manage", "file", "post", "reconcile", "close_period", "reopen_period"];

const ROLE_PERMISSIONS: Record<Actor["role"], Matrix> = {
  admin: {
    leads: ALL, clients: ALL, engagements: ALL, tasks: ALL, templates: ALL, billing: ALL, team: ALL, settings: ALL, reports: ALL,
    tax_preparation: ALL, tax_returns: ALL, bookkeeping: ALL, calendar: ALL,
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
    tax_preparation: ["view", "create", "edit", "assign", "approve", "manage"],
    tax_returns: ["view", "create", "edit", "assign", "approve", "file", "manage"],
    bookkeeping: ["view", "create", "edit", "assign", "approve", "manage", "post", "reconcile", "close_period", "reopen_period"],
    calendar: ["view", "create", "edit", "delete", "assign", "manage"],
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
    tax_preparation: ["view", "create", "edit"],
    tax_returns: ["view", "create", "edit", "approve"],
    bookkeeping: ["view", "create", "edit"],
    calendar: ["view", "create", "edit"],
  },
  // Auditors / observers: see everything in the firm, change nothing. Billing is excluded on purpose.
  read_only: {
    leads: ["view"], clients: ["view"], engagements: ["view"], tasks: ["view"], templates: ["view"], reports: ["view"],
    tax_preparation: ["view"], tax_returns: ["view"], bookkeeping: ["view"], calendar: ["view"],
  },
  client: {},
};

export function can(actor: Pick<Actor, "role">, module: Module, action: Action): boolean {
  return ROLE_PERMISSIONS[actor.role]?.[module]?.includes(action) ?? false;
}

/** Everything one role may do, for the UI (hide buttons the server would refuse anyway). */
export function permissionsFor(actor: Pick<Actor, "role">): Record<Module, Action[]> {
  const m = ROLE_PERMISSIONS[actor.role] ?? {};
  return Object.fromEntries(
    (["leads", "clients", "engagements", "tasks", "templates", "billing", "team", "settings", "reports", "tax_preparation", "tax_returns", "bookkeeping", "calendar"] as Module[])
      .map((k) => [k, [...(m[k] ?? [])]]),
  ) as Record<Module, Action[]>;
}
