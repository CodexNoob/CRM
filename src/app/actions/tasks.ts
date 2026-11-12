"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import type { TaskStatus } from "@/db/schema";
import { errorState, formValues, type ActionState } from "@/lib/action-state";
import { requireStaffActor } from "@/lib/auth/current";
import { ValidationError } from "@/lib/errors";
import {
  addChecklistItem,
  addTaskComment,
  archiveTask,
  assignTask,
  attachTaskFile,
  createTask,
  getTask,
  removeChecklistItem,
  setChecklistItemDone,
  setTaskStatus,
  updateTask,
} from "@/services/tasks";
import { saveTemplate, setTemplateActive } from "@/services/workflows";

/* Every action re-authenticates; the services re-authorize every record. */

function taskInput(formData: FormData): Record<string, unknown> {
  const v: Record<string, unknown> = formValues(formData);
  v.dependsOn = formData.getAll("dependsOn").filter((x): x is string => typeof x === "string" && x !== "");
  return v;
}

/** Refreshes the task lists, the task page, and its engagement/client pages. */
async function refreshTask(taskId?: string, link?: { engagementId?: string | null; clientId?: string | null }) {
  revalidatePath("/staff/tasks", "layout");
  revalidatePath("/staff");
  if (taskId) revalidatePath(`/staff/tasks/${taskId}`);
  if (link?.engagementId) revalidatePath(`/staff/engagements/${link.engagementId}`);
  if (link?.clientId) revalidatePath(`/staff/clients/${link.clientId}`);
}

/** Looks up the task's links for revalidation; never throws. */
async function linksOf(taskId: string) {
  try {
    const actor = await requireStaffActor();
    const d = await getTask(getDb(), actor, taskId);
    return { engagementId: d.task.engagementId, clientId: d.task.clientId };
  } catch {
    return {};
  }
}

export async function createTaskAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireStaffActor();
  let id: string;
  try {
    const engagementId = formData.get("engagementId");
    const task = await createTask(getDb(), actor, taskInput(formData), { engagementId: typeof engagementId === "string" && engagementId ? engagementId : undefined });
    id = task.id;
    await refreshTask(task.id, task);
  } catch (error) {
    return errorState(error, formData);
  }
  redirect(`/staff/tasks/${id}`);
}

/** Subtask from the task page: stays on the parent. */
export async function createSubtaskAction(parentId: string, engagementId: string | null, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireStaffActor();
  try {
    const input = taskInput(formData);
    input.parentTaskId = parentId;
    const task = await createTask(getDb(), actor, input, { engagementId: engagementId ?? undefined });
    await refreshTask(parentId, task);
  } catch (error) {
    return errorState(error, formData);
  }
  return { status: "success", message: "Subtask added." };
}

export async function updateTaskAction(taskId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireStaffActor();
  try {
    const task = await updateTask(getDb(), actor, taskId, taskInput(formData));
    await refreshTask(taskId, task);
  } catch (error) {
    return errorState(error, formData);
  }
  return { status: "success", message: "Task saved." };
}

export async function setTaskStatusAction(taskId: string, status: TaskStatus, note?: string): Promise<ActionState> {
  const actor = await requireStaffActor();
  try {
    const task = await setTaskStatus(getDb(), actor, taskId, status, note);
    await refreshTask(taskId, task);
  } catch (error) {
    return errorState(error);
  }
  return { status: "success", message: "Status updated." };
}

export async function assignTaskAction(taskId: string, assigneeId: string | null): Promise<ActionState> {
  const actor = await requireStaffActor();
  try {
    await assignTask(getDb(), actor, taskId, assigneeId);
    await refreshTask(taskId, await linksOf(taskId));
  } catch (error) {
    return errorState(error);
  }
  return { status: "success", message: assigneeId ? "Task assigned." : "Task unassigned." };
}

/** Form version (Assign dialog). */
export async function assignTaskFormAction(taskId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const v = formData.get("assigneeId");
  return assignTaskAction(taskId, typeof v === "string" && v ? v : null);
}

export async function addTaskCommentAction(taskId: string, kind: "comment" | "internal_note", _prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireStaffActor();
  try {
    const body = formData.get("body");
    await addTaskComment(getDb(), actor, taskId, kind, typeof body === "string" ? body : "");
    await refreshTask(taskId);
  } catch (error) {
    return errorState(error, formData);
  }
  return { status: "success", message: kind === "internal_note" ? "Internal note added." : "Comment added." };
}

export async function addChecklistItemAction(taskId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireStaffActor();
  try {
    const title = formData.get("title");
    await addChecklistItem(getDb(), actor, taskId, typeof title === "string" ? title : "");
    await refreshTask(taskId);
  } catch (error) {
    return errorState(error, formData);
  }
  return { status: "success", message: "Checklist item added." };
}

export async function setChecklistItemAction(taskId: string, itemId: string, done: boolean): Promise<ActionState> {
  const actor = await requireStaffActor();
  try {
    await setChecklistItemDone(getDb(), actor, taskId, itemId, done);
    await refreshTask(taskId);
  } catch (error) {
    return errorState(error);
  }
  return { status: "success" };
}

export async function removeChecklistItemAction(taskId: string, itemId: string): Promise<ActionState> {
  const actor = await requireStaffActor();
  try {
    await removeChecklistItem(getDb(), actor, taskId, itemId);
    await refreshTask(taskId);
  } catch (error) {
    return errorState(error);
  }
  return { status: "success", message: "Checklist item removed." };
}

export async function attachTaskFileAction(taskId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireStaffActor();
  try {
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) throw new ValidationError({ file: ["Choose a file to upload."] });
    await attachTaskFile(getDb(), actor, taskId, { fileName: file.name, data: Buffer.from(await file.arrayBuffer()) });
    await refreshTask(taskId, await linksOf(taskId));
  } catch (error) {
    return errorState(error);
  }
  return { status: "success", message: "File attached." };
}

export async function archiveTaskAction(taskId: string): Promise<ActionState> {
  const actor = await requireStaffActor();
  try {
    const links = await linksOf(taskId);
    await archiveTask(getDb(), actor, taskId);
    await refreshTask(taskId, links);
  } catch (error) {
    return errorState(error);
  }
  return { status: "success", message: "Task archived." };
}

/* ───────── Workflow templates ───────── */

/** The steps editor posts steps as JSON (ordered); the service validates every field. */
export async function saveTemplateAction(templateId: string | null, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireStaffActor();
  let id: string;
  try {
    let steps: unknown = [];
    try {
      steps = JSON.parse(String(formData.get("steps") ?? "[]"));
    } catch {
      throw new ValidationError({ steps: ["The steps couldn’t be read. Reload the page and try again."] });
    }
    const input = { ...formValues(formData), steps };
    id = (await saveTemplate(getDb(), actor, templateId, input)).id;
  } catch (error) {
    return errorState(error, formData);
  }
  revalidatePath("/staff/tasks/templates", "layout");
  if (!templateId) redirect(`/staff/tasks/templates/${id}`);
  return { status: "success", message: "Template saved." };
}

export async function setTemplateActiveAction(templateId: string, active: boolean): Promise<ActionState> {
  const actor = await requireStaffActor();
  try {
    await setTemplateActive(getDb(), actor, templateId, active);
  } catch (error) {
    return errorState(error);
  }
  revalidatePath("/staff/tasks/templates", "layout");
  return { status: "success", message: active ? "Template activated." : "Template deactivated." };
}
