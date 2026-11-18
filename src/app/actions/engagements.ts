"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import type { EngagementStatus, TaskStatus } from "@/db/schema";
import { errorState, formValues, type ActionState } from "@/lib/action-state";
import { requireStaffActor } from "@/lib/auth/current";
import { ValidationError } from "@/lib/errors";
import { firmToday } from "@/services/dashboard";
import { uploadDocument } from "@/services/documents";
import {
  createEngagement,
  loadEngagementForStaff,
  overrideWorkStart,
  setEngagementStatus,
  setEngagementTeam,
  setProposalStatus,
  updateEngagement,
} from "@/services/engagements";
import { createTask, setTaskStatus } from "@/services/tasks";
import { DuplicateWorkflowError, generateWorkflow, previewWorkflow, type PlannedTask } from "@/services/workflows";

/*
 * Engagement actions. Every action re-authenticates; the services re-authorize every record
 * (firm, client access, role permissions, lifecycle rules). Bound ids are untrusted input.
 */

/** formValues() plus multi-value fields (checkbox groups) as arrays. */
function formInput(formData: FormData, multi: string[] = []): Record<string, unknown> {
  const v: Record<string, unknown> = formValues(formData);
  for (const k of multi) v[k] = formData.getAll(k).filter((x): x is string => typeof x === "string" && x !== "");
  return v;
}

function refresh(engagementId?: string, clientId?: string) {
  if (engagementId) revalidatePath(`/crm/engagements/${engagementId}`);
  revalidatePath("/crm/engagements");
  if (clientId) revalidatePath(`/crm/clients/${clientId}`);
  revalidatePath("/crm");
}

export async function createEngagementAction(clientId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireStaffActor();
  let id: string;
  try {
    id = (await createEngagement(getDb(), actor, clientId, formInput(formData, ["staffIds"]))).id;
  } catch (error) {
    return errorState(error, formData);
  }
  refresh(id, clientId);
  redirect(`/crm/engagements/${id}?created=1&tab=tasks`);
}

/** "New engagement" from the list: the client comes from the form. */
export async function createEngagementWithClientAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const clientId = formData.get("clientId");
  if (typeof clientId !== "string" || !clientId) return { status: "error", message: "Choose a client.", fieldErrors: { clientId: ["Choose a client."] } };
  return createEngagementAction(clientId, _prev, formData);
}

export async function updateEngagementAction(engagementId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireStaffActor();
  let clientId: string | undefined;
  try {
    clientId = (await updateEngagement(getDb(), actor, engagementId, formInput(formData, ["staffIds"]))).clientId;
  } catch (error) {
    return errorState(error, formData);
  }
  refresh(engagementId, clientId);
  return { status: "success", message: "Engagement saved." };
}

export async function setEngagementStatusAction(engagementId: string, status: EngagementStatus, note?: string): Promise<ActionState> {
  const actor = await requireStaffActor();
  try {
    await setEngagementStatus(getDb(), actor, engagementId, status, note);
  } catch (error) {
    return errorState(error);
  }
  refresh(engagementId);
  return { status: "success", message: "Status updated." };
}

export async function setProposalAction(engagementId: string, proposal: "draft" | "sent" | "accepted" | "declined", acceptedOn?: string): Promise<ActionState> {
  const actor = await requireStaffActor();
  try {
    if (acceptedOn && !/^\d{4}-\d{2}-\d{2}$/.test(acceptedOn)) throw new ValidationError({ acceptedOn: ["Use a valid date."] });
    await setProposalStatus(getDb(), actor, engagementId, proposal, acceptedOn || undefined);
  } catch (error) {
    return errorState(error);
  }
  refresh(engagementId);
  return { status: "success", message: proposal === "accepted" ? "Acceptance recorded. Work can start." : `Proposal marked ${proposal}.` };
}

export async function overrideWorkStartAction(engagementId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireStaffActor();
  try {
    await overrideWorkStart(getDb(), actor, engagementId, String(formData.get("reason") ?? ""));
  } catch (error) {
    return errorState(error, formData);
  }
  refresh(engagementId);
  return { status: "success", message: "Work may start before acceptance." };
}

export async function setEngagementTeamAction(engagementId: string, members: { userId: string; role: "manager" | "staff" | "reviewer" }[]): Promise<ActionState> {
  const actor = await requireStaffActor();
  try {
    await setEngagementTeam(getDb(), actor, engagementId, { members });
  } catch (error) {
    return errorState(error);
  }
  refresh(engagementId);
  return { status: "success", message: "Team updated." };
}

export async function createEngagementTaskAction(engagementId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireStaffActor();
  try {
    await createTask(getDb(), actor, formInput(formData, ["dependsOn"]), { engagementId });
  } catch (error) {
    return errorState(error, formData);
  }
  refresh(engagementId);
  revalidatePath("/crm/tasks");
  return { status: "success", message: "Task added." };
}

export async function setEngagementTaskStatusAction(engagementId: string, taskId: string, status: TaskStatus): Promise<ActionState> {
  const actor = await requireStaffActor();
  try {
    await setTaskStatus(getDb(), actor, taskId, status);
  } catch (error) {
    return errorState(error);
  }
  refresh(engagementId);
  revalidatePath("/crm/tasks");
  return { status: "success", message: "Task updated." };
}

export type PreviewResult = { status: "ok"; planned: PlannedTask[]; alreadyGenerated: boolean } | { status: "error"; message: string };

export async function previewWorkflowAction(engagementId: string, templateId: string): Promise<PreviewResult> {
  const actor = await requireStaffActor();
  try {
    const p = await previewWorkflow(getDb(), actor, engagementId, templateId, firmToday());
    return { status: "ok", planned: p.planned, alreadyGenerated: p.alreadyGenerated };
  } catch (error) {
    const s = errorState(error);
    return { status: "error", message: s.fieldErrors?._form?.join(" ") || s.fieldErrors?.templateId?.join(" ") || s.message || "Couldn’t load the template." };
  }
}

export async function generateWorkflowAction(
  engagementId: string,
  templateId: string,
  overrides: { sequence: number; assigneeId?: string; dueDate?: string; skip?: boolean }[],
): Promise<ActionState> {
  const actor = await requireStaffActor();
  let count = 0;
  try {
    const res = await generateWorkflow(
      getDb(),
      actor,
      engagementId,
      { templateId, overrides: overrides.map((o) => ({ sequence: o.sequence, assigneeId: o.assigneeId ?? "", dueDate: o.dueDate ?? "", skip: o.skip ? "on" : "" })) },
      firmToday(),
    );
    count = res.taskIds.length;
  } catch (error) {
    if (error instanceof DuplicateWorkflowError) return { status: "error", message: "These tasks were already generated for this engagement." };
    return errorState(error);
  }
  refresh(engagementId);
  revalidatePath("/crm/tasks");
  return { status: "success", message: `${count} tasks created.` };
}

export async function uploadEngagementDocumentAction(engagementId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireStaffActor();
  let clientId: string;
  try {
    const db = getDb();
    const e = await loadEngagementForStaff(db, actor, engagementId);
    clientId = e.clientId;
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) throw new ValidationError({ file: ["Choose a file to upload."] });
    await uploadDocument(db, actor, {
      clientId,
      engagementId,
      visibleToClient: formData.get("visibleToClient") === "on",
      fileName: file.name,
      data: Buffer.from(await file.arrayBuffer()),
    });
  } catch (error) {
    return errorState(error);
  }
  refresh(engagementId, clientId);
  revalidatePath("/crm/documents");
  return { status: "success", message: "File uploaded." };
}
