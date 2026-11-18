"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import type { EngagementStatus, TaskStatus } from "@/db/schema";
import type { ActionState } from "@/lib/action-state";
import { requireStaffActor } from "@/lib/auth/current";
import { AppError } from "@/lib/errors";
import { archiveDocument, setDocumentShared } from "@/services/documents";
import { setEngagementStatus } from "@/services/engagements";
import { setTaskStatus } from "@/services/tasks";
import { setLeadStatus } from "@/services/leads";

/**
 * Bulk actions apply the normal single-record service to each id, so every
 * record is individually authorised and audited. Partial failures are reported.
 */
const MAX_BULK = 200;

async function each(ids: unknown, fn: (id: string) => Promise<void>, noun: string): Promise<ActionState> {
  const list = Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string").slice(0, MAX_BULK) : [];
  let ok = 0;
  const failures: string[] = [];
  for (const id of list) {
    try {
      await fn(id);
      ok++;
    } catch (e) {
      failures.push(e instanceof AppError ? e.message : "unexpected error");
      if (!(e instanceof AppError)) console.error("Bulk action failed", { name: (e as Error)?.name });
    }
  }
  revalidatePath("/crm", "layout");
  if (failures.length) {
    return { status: "error", message: `${ok} ${noun} updated, ${failures.length} skipped (${[...new Set(failures)].slice(0, 2).join("; ")}).` };
  }
  return { status: "success", message: `${ok} ${noun} updated.` };
}

/** Moves tasks to a status ("open"/"done" accepted for older callers). Blocked or ineligible tasks are skipped and reported. */
export async function bulkTaskStatusAction(ids: string[], status: TaskStatus | "open" | "done") {
  const actor = await requireStaffActor();
  return each(ids, (id) => setTaskStatus(getDb(), actor, id, status).then(() => undefined), ids.length === 1 ? "task" : "tasks");
}

/** Moves leads to a stage. "lost" needs a reason (applied to every lead); converted leads are skipped by the service. */
export async function bulkLeadStatusAction(ids: string[], status: string, lostReason?: string) {
  const actor = await requireStaffActor();
  return each(ids, (id) => setLeadStatus(getDb(), actor, id, { status, lostReason }), ids.length === 1 ? "lead" : "leads");
}

export async function bulkEngagementStatusAction(ids: string[], status: EngagementStatus) {
  const actor = await requireStaffActor();
  return each(ids, (id) => setEngagementStatus(getDb(), actor, id, status), ids.length === 1 ? "engagement" : "engagements");
}

export async function bulkDocumentShareAction(ids: string[], shared: boolean) {
  const actor = await requireStaffActor();
  return each(ids, (id) => setDocumentShared(getDb(), actor, id, shared === true), ids.length === 1 ? "document" : "documents");
}

export async function bulkDocumentArchiveAction(ids: string[]) {
  const actor = await requireStaffActor();
  return each(ids, (id) => archiveDocument(getDb(), actor, id), ids.length === 1 ? "document" : "documents");
}
