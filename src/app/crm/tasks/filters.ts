import type { Priority, TaskStatus } from "@/db/schema";
import type { TaskFilters } from "@/services/tasks";

/** Every status, in workflow order. */
export const TASK_STATUSES: TaskStatus[] = ["todo", "in_progress", "waiting_client", "waiting_review", "blocked", "completed", "cancelled"];
/** Board columns (cancelled tasks aren't shown on the board). */
export const BOARD_STATUSES: TaskStatus[] = ["todo", "in_progress", "waiting_client", "waiting_review", "blocked", "completed"];
export const PRIORITIES: Priority[] = ["low", "normal", "high", "urgent"];

export type TaskView = "list" | "board" | "calendar";
export type TaskScope = "mine" | "team" | "client";
export type TaskSearchParams = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);

export interface ParsedTaskParams {
  view: TaskView;
  scope: TaskScope;
  month: string; // YYYY-MM
  filters: TaskFilters;
  /** The raw filter values, to refill the filter form and build links. */
  raw: { q: string; status: string; assignee: string; priority: string; due: string; client: string };
}

/** Parses ?view=&scope=&q=&status=&assignee=&priority=&due=&client=&month=. Unknown values are ignored. */
export function parseTaskParams(sp: TaskSearchParams, today: string): ParsedTaskParams {
  const view = one(sp.view);
  const scope = one(sp.scope);
  const status = one(sp.status) ?? "";
  const assignee = one(sp.assignee) ?? "";
  const priority = one(sp.priority) ?? "";
  const due = one(sp.due) ?? "";
  const client = one(sp.client) ?? "";
  const month = one(sp.month);
  const q = (one(sp.q) ?? "").trim().slice(0, 100);
  const s: ParsedTaskParams["scope"] = scope === "team" || scope === "client" ? scope : "mine";
  const v: TaskView = view === "board" || view === "calendar" ? view : "list";
  return {
    view: v,
    scope: s,
    month: month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : today.slice(0, 7),
    filters: {
      today,
      q: q || undefined,
      mine: s === "mine",
      // The board shows every status column, so it ignores the open/done split unless a status was chosen.
      status: TASK_STATUSES.includes(status as TaskStatus) ? (status as TaskStatus) : status === "done" || status === "all" ? status : v === "board" ? "all" : "open",
      assigneeId: assignee === "none" ? "none" : isUuid(assignee) ? assignee : undefined,
      priority: PRIORITIES.includes(priority as Priority) ? (priority as Priority) : undefined,
      due: due === "overdue" || due === "today" || due === "week" || due === "none" ? due : undefined,
      clientId: isUuid(client) ? client : undefined,
    },
    raw: { q, status, assignee, priority, due, client },
  };
}

/** Builds /crm/tasks?… keeping the current filters and overriding some keys. */
export function tasksHref(p: ParsedTaskParams, over: Partial<Record<"view" | "scope" | "month", string>> = {}): string {
  const params = new URLSearchParams();
  const view = over.view ?? p.view;
  const scope = over.scope ?? p.scope;
  if (view !== "list") params.set("view", view);
  if (scope !== "mine") params.set("scope", scope);
  for (const [k, v] of Object.entries(p.raw)) if (v) params.set(k, v);
  const month = over.month ?? (view === "calendar" ? p.month : undefined);
  if (month) params.set("month", month);
  const s = params.toString();
  return s ? `/crm/tasks?${s}` : "/crm/tasks";
}
