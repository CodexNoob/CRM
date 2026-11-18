"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { errorState, formValues, type ActionState } from "@/lib/action-state";
import { requireClientActor, requireStaffActor } from "@/lib/auth/current";
import { ValidationError } from "@/lib/errors";
import { cancelAppointment, createAppointment } from "@/services/calendar";
import { documents } from "@/db/schema";
import { requirePortalContext } from "@/lib/auth/portal-context";
import { archiveDocument, setDocumentShared, uploadDocument } from "@/services/documents";

const DOCUMENT_CATEGORIES = documents.category.enumValues;
import { sendMessage } from "@/services/messages";

/* Every action re-authenticates; the services re-authorize every record. */

async function fileFromForm(formData: FormData): Promise<{ fileName: string; data: Buffer }> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) throw new ValidationError({ file: ["Choose a file to upload."] });
  return { fileName: file.name, data: Buffer.from(await file.arrayBuffer()) };
}

/* Lead and client actions live in ./crm.ts. */

/* ───────── Documents ───────── */

export async function staffUploadAction(clientId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireStaffActor();
  try {
    const file = await fileFromForm(formData);
    const str = (k: string) => {
      const v = formData.get(k);
      return typeof v === "string" && v.trim() ? v.trim() : undefined;
    };
    const visibility = str("visibility");
    const category = str("category");
    await uploadDocument(getDb(), actor, {
      clientId,
      engagementId: str("engagementId"),
      taxPreparationCaseId: str("taxPreparationCaseId"),
      taxReturnId: str("taxReturnId"),
      visibleToClient: formData.get("visibleToClient") === "on",
      visibility: visibility === "internal_only" || visibility === "client_visible" || visibility === "shared_with_client" ? visibility : undefined,
      category: category && (DOCUMENT_CATEGORIES as readonly string[]).includes(category) ? (category as (typeof DOCUMENT_CATEGORIES)[number]) : undefined,
      title: str("title"),
      taxYear: str("taxYear") && /^\d{4}$/.test(str("taxYear")!) ? Number(str("taxYear")) : undefined,
      ...file,
    });
  } catch (error) {
    return errorState(error);
  }
  revalidatePath(`/crm/clients/${clientId}`);
  revalidatePath("/crm/documents");
  return { status: "success", message: "File uploaded." };
}

export async function setDocumentSharedAction(id: string, shared: boolean, _prev: ActionState, _formData: FormData): Promise<ActionState> {
  const actor = await requireStaffActor();
  try {
    await setDocumentShared(getDb(), actor, id, shared === true);
  } catch (error) {
    return errorState(error);
  }
  revalidatePath("/crm", "layout");
  return { status: "success" };
}

export async function archiveDocumentAction(id: string, _prev: ActionState, _formData: FormData): Promise<ActionState> {
  const actor = await requireStaffActor();
  try {
    await archiveDocument(getDb(), actor, id);
  } catch (error) {
    return errorState(error);
  }
  revalidatePath("/crm", "layout");
  return { status: "success" };
}

/** Portal upload. The client is the one resolved on the server for this portal session — never a value from the form. */
export async function portalUploadAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requirePortalContext();
  try {
    const file = await fileFromForm(formData);
    await uploadDocument(getDb(), ctx.actor, { clientId: ctx.client.clientId, ...file });
  } catch (error) {
    return errorState(error);
  }
  revalidatePath("/portal", "layout");
  return { status: "success", message: "Thanks, your file was uploaded securely." };
}

/* ───────── Messages ───────── */

export async function staffMessageAction(clientId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireStaffActor();
  try {
    await sendMessage(getDb(), actor, formData.get("body"), clientId);
  } catch (error) {
    return errorState(error, formData);
  }
  revalidatePath("/crm/messages", "layout");
  return { status: "success" };
}

export async function portalMessageAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireClientActor();
  try {
    await sendMessage(getDb(), actor, formData.get("body"));
  } catch (error) {
    return errorState(error, formData);
  }
  revalidatePath("/portal", "layout");
  return { status: "success" };
}

/* ───────── Calendar ───────── */

export async function createAppointmentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireStaffActor();
  try {
    await createAppointment(getDb(), actor, formValues(formData));
  } catch (error) {
    return errorState(error, formData);
  }
  revalidatePath("/crm/calendar");
  return { status: "success", message: "Appointment added." };
}

export async function cancelAppointmentAction(id: string, _prev: ActionState, _formData: FormData): Promise<ActionState> {
  const actor = await requireStaffActor();
  try {
    await cancelAppointment(getDb(), actor, id);
  } catch (error) {
    return errorState(error);
  }
  revalidatePath("/crm/calendar");
  return { status: "success" };
}
