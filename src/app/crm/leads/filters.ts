import type { LeadSource, LeadStatus, Priority } from "@/db/schema";
import type { LeadFilters } from "@/services/leads";

/** Pipeline order, used by the stage strip, the kanban board and stage pickers. */
export const LEAD_STAGES: LeadStatus[] = ["new", "contacted", "qualified", "consultation_scheduled", "proposal_sent", "negotiation", "converted", "lost", "nurture"];
/** Stages a user can move a lead to by hand ("converted" only happens through conversion). */
export const MOVABLE_STAGES: Exclude<LeadStatus, "converted">[] = ["new", "contacted", "qualified", "consultation_scheduled", "proposal_sent", "negotiation", "lost", "nurture"];

const SOURCES: LeadSource[] = ["website", "referral", "phone", "walk_in", "other"];
const PRIORITIES: Priority[] = ["low", "normal", "high", "urgent"];
const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);

export type LeadSearchParams = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Parses ?q=&status=&source=&owner=&priority=&from=&to=&followup=due&sort= into service filters. Unknown values are ignored. */
export function parseLeadFilters(sp: LeadSearchParams, today: string): LeadFilters {
  const status = one(sp.status);
  const source = one(sp.source);
  const owner = one(sp.owner);
  const priority = one(sp.priority);
  const from = one(sp.from);
  const to = one(sp.to);
  const q = one(sp.q)?.trim().slice(0, 100);
  return {
    q: q || undefined,
    status: status === "open" ? "open" : LEAD_STAGES.includes(status as LeadStatus) ? (status as LeadStatus) : undefined,
    source: SOURCES.includes(source as LeadSource) ? (source as LeadSource) : undefined,
    ownerId: owner === "none" ? "none" : isUuid(owner) ? owner : undefined,
    priority: PRIORITIES.includes(priority as Priority) ? (priority as Priority) : undefined,
    createdFrom: isDate(from) ? from : undefined,
    createdTo: isDate(to) ? to : undefined,
    followUpDue: one(sp.followup) === "due",
    today,
    sort: one(sp.sort) === "follow_up" ? "follow_up" : "created",
  };
}

/** Rebuilds the query string for the current filters (keeps view, drops empties). */
export function leadQuery(sp: LeadSearchParams, overrides: Record<string, string | undefined> = {}): string {
  const keys = ["q", "status", "source", "owner", "priority", "from", "to", "followup", "sort", "view"];
  const p = new URLSearchParams();
  for (const k of keys) {
    const v = k in overrides ? overrides[k] : one(sp[k]);
    if (v) p.set(k, v);
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}
