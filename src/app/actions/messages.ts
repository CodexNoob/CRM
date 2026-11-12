"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { errorState, formValues, type ActionState } from "@/lib/action-state";
import { requireStaffActor } from "@/lib/auth/current";
import { requirePortalContext } from "@/lib/auth/portal-context";
import { ValidationError } from "@/lib/errors";
import {
  assignConversation,
  createConversation,
  createPortalConversation,
  replyAsClient,
  replyAsStaff,
  setConversationStatus,
  updateConversationDetails,
  type AttachmentInput,
} from "@/services/messages";
import type { ConversationStatus } from "@/db/schema";

/** Files from a form's "attachments" input (empty file inputs are ignored). At most 5 per message. */
async function attachmentsFrom(formData: FormData): Promise<AttachmentInput[]> {
  const files = formData.getAll("attachments").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length > 5) throw new ValidationError({ attachments: ["Attach at most 5 files per message."] });
  return Promise.all(files.map(async (f) => ({ fileName: f.name, data: Buffer.from(await f.arrayBuffer()) })));
}

const refreshStaff = (conversationId?: string, clientId?: string) => {
  revalidatePath("/staff/messages", "layout");
  if (conversationId) revalidatePath(`/staff/messages/${conversationId}`);
  if (clientId) revalidatePath(`/staff/clients/${clientId}`);
  revalidatePath("/staff", "layout");
};

/* ───────── Staff ───────── */

export async function createConversationAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireStaffActor();
  let id: string;
  try {
    const clientId = String(formData.get("clientId") ?? "");
    const c = await createConversation(getDb(), actor, clientId, formValues(formData), await attachmentsFrom(formData));
    id = c.id;
    refreshStaff(c.id, c.clientId);
  } catch (error) {
    return errorState(error, formData);
  }
  redirect(`/staff/messages/${id}`);
}

export async function staffReplyAction(conversationId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireStaffActor();
  const internal = formData.get("mode") === "internal";
  try {
    await replyAsStaff(getDb(), actor, conversationId, { body: formData.get("body"), internal }, await attachmentsFrom(formData));
  } catch (error) {
    return errorState(error, formData);
  }
  refreshStaff(conversationId);
  return { status: "success", message: internal ? "Internal note added." : "Message sent." };
}

export async function setConversationStatusAction(conversationId: string, status: ConversationStatus): Promise<ActionState> {
  const actor = await requireStaffActor();
  try {
    await setConversationStatus(getDb(), actor, conversationId, status);
  } catch (error) {
    return errorState(error);
  }
  refreshStaff(conversationId);
  return { status: "success", message: "Status updated." };
}

export async function assignConversationAction(conversationId: string, assigneeId: string | null): Promise<ActionState> {
  const actor = await requireStaffActor();
  try {
    await assignConversation(getDb(), actor, conversationId, assigneeId);
  } catch (error) {
    return errorState(error);
  }
  refreshStaff(conversationId);
  return { status: "success", message: assigneeId ? "Conversation assigned." : "Conversation unassigned." };
}

export async function updateConversationAction(conversationId: string, patch: { category?: string; priority?: string }): Promise<ActionState> {
  const actor = await requireStaffActor();
  try {
    await updateConversationDetails(getDb(), actor, conversationId, patch);
  } catch (error) {
    return errorState(error);
  }
  refreshStaff(conversationId);
  return { status: "success", message: "Conversation updated." };
}

/* ───────── Portal (client resolved on the server) ───────── */

export async function portalCreateConversationAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { actor, client } = await requirePortalContext();
  let id: string;
  try {
    id = (await createPortalConversation(getDb(), actor, client.clientId, formValues(formData), await attachmentsFrom(formData))).id;
  } catch (error) {
    return errorState(error, formData);
  }
  revalidatePath("/portal", "layout");
  redirect(`/portal/messages/${id}`);
}

export async function portalReplyAction(conversationId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { actor, client } = await requirePortalContext();
  try {
    await replyAsClient(getDb(), actor, client.clientId, conversationId, formData.get("body"), await attachmentsFrom(formData));
  } catch (error) {
    return errorState(error, formData);
  }
  revalidatePath("/portal", "layout");
  return { status: "success", message: "Message sent." };
}
