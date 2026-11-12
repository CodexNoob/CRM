"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { errorState, formValues, type ActionState } from "@/lib/action-state";
import { requireStaffActor } from "@/lib/auth/current";
import { createClient, updateClient } from "@/services/clients";
import { createEngagement, createTask, setTaskStatus, updateEngagement } from "@/services/engagements";
import { createPortalInvitation } from "@/services/users";

/*
 * Server Actions are public HTTP endpoints. Each one re-authenticates and the
 * service layer re-authorizes; bound ids are treated as untrusted input.
 */

export async function createClientAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireStaffActor();
  let id: string;
  try {
    id = (await createClient(getDb(), actor, formValues(formData))).id;
  } catch (error) {
    return errorState(error, formData);
  }
  revalidatePath("/staff/clients");
  redirect(`/staff/clients/${id}`);
}

export async function updateClientAction(clientId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireStaffActor();
  try {
    await updateClient(getDb(), actor, clientId, formValues(formData));
  } catch (error) {
    return errorState(error, formData);
  }
  revalidatePath("/staff/clients");
  revalidatePath(`/staff/clients/${clientId}`);
  redirect(`/staff/clients/${clientId}`);
}

export async function createEngagementAction(clientId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireStaffActor();
  let id: string;
  try {
    id = (await createEngagement(getDb(), actor, clientId, formValues(formData))).id;
  } catch (error) {
    return errorState(error, formData);
  }
  redirect(`/staff/engagements/${id}`);
}

export async function updateEngagementAction(
  engagementId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireStaffActor();
  try {
    await updateEngagement(getDb(), actor, engagementId, formValues(formData));
  } catch (error) {
    return errorState(error, formData);
  }
  revalidatePath(`/staff/engagements/${engagementId}`);
  return { status: "success", message: "Engagement saved." };
}

export async function createTaskAction(engagementId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireStaffActor();
  try {
    await createTask(getDb(), actor, engagementId, formValues(formData));
  } catch (error) {
    return errorState(error, formData);
  }
  revalidatePath(`/staff/engagements/${engagementId}`);
  return { status: "success", message: "Task added." };
}

export async function setTaskStatusAction(
  taskId: string,
  status: "open" | "done",
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const actor = await requireStaffActor();
  try {
    await setTaskStatus(getDb(), actor, taskId, status === "done" ? "done" : "open");
  } catch (error) {
    return errorState(error);
  }
  revalidatePath("/staff", "layout");
  return { status: "success" };
}

export async function createPortalInviteAction(clientId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireStaffActor();
  try {
    const { token } = await createPortalInvitation(getDb(), actor, clientId, formValues(formData));
    const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
    revalidatePath(`/staff/clients/${clientId}`);
    return {
      status: "success",
      message: "Invitation created. Send this link to the client through a trusted channel. It works once and expires in 72 hours.",
      data: { link: `${base}/setup-password?token=${encodeURIComponent(token)}` },
    };
  } catch (error) {
    return errorState(error, formData);
  }
}
