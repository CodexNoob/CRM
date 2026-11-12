"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { documents, type DocumentVisibility } from "@/db/schema";
import { errorState, formValues, type ActionState } from "@/lib/action-state";
import { requireStaffActor } from "@/lib/auth/current";
import { requirePortalContext } from "@/lib/auth/portal-context";
import { ValidationError } from "@/lib/errors";
import { cancelDocumentRequest, createDocumentRequest, sendDocumentRequest, waiveRequestItem } from "@/services/document-requests";
import { archiveDocument, reviewDocument, setDocumentVisibility, updateDocumentMetadata, uploadDocument, uploadNewVersion, type ReviewAction } from "@/services/documents";

/* Every action re-authenticates; the services re-authorize every record. */

const CATEGORIES = documents.category.enumValues;

async function fileFromForm(formData: FormData): Promise<{ fileName: string; data: Buffer }> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) throw new ValidationError({ file: ["Choose a file to upload."] });
  return { fileName: file.name, data: Buffer.from(await file.arrayBuffer()) };
}

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
};

function refreshStaff(clientId?: string) {
  revalidatePath("/staff/documents", "layout");
  if (clientId) revalidatePath(`/staff/clients/${clientId}`);
  revalidatePath("/portal", "layout");
}

/* ───────── Staff ───────── */

/** Upload from /staff/documents (client chosen in the form; access re-checked by the service). */
export async function staffDocumentUploadAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireStaffActor();
  const clientId = str(formData, "clientId");
  try {
    if (!clientId) throw new ValidationError({ clientId: ["Choose a client."] });
    const file = await fileFromForm(formData);
    const visibility = str(formData, "visibility");
    const category = str(formData, "category");
    const year = str(formData, "taxYear");
    await uploadDocument(getDb(), actor, {
      clientId,
      engagementId: str(formData, "engagementId"),
      taxPreparationCaseId: str(formData, "taxPreparationCaseId"),
      taxReturnId: str(formData, "taxReturnId"),
      requestItemId: str(formData, "requestItemId"),
      visibility: visibility === "internal_only" || visibility === "client_visible" || visibility === "shared_with_client" ? visibility : "internal_only",
      category: category && (CATEGORIES as readonly string[]).includes(category) ? (category as (typeof CATEGORIES)[number]) : undefined,
      title: str(formData, "title"),
      description: str(formData, "description"),
      taxYear: year && /^\d{4}$/.test(year) ? Number(year) : undefined,
      ...file,
    });
  } catch (error) {
    return errorState(error, formData);
  }
  refreshStaff(clientId);
  return { status: "success", message: "Document uploaded." };
}

export async function staffNewVersionAction(documentId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireStaffActor();
  try {
    await uploadNewVersion(getDb(), actor, documentId, await fileFromForm(formData));
  } catch (error) {
    return errorState(error);
  }
  refreshStaff();
  return { status: "success", message: "New version uploaded. The previous version is kept in the history." };
}

export async function updateDocumentMetadataAction(documentId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireStaffActor();
  try {
    await updateDocumentMetadata(getDb(), actor, documentId, formValues(formData));
  } catch (error) {
    return errorState(error, formData);
  }
  refreshStaff();
  return { status: "success", message: "Details saved." };
}

export async function reviewDocumentAction(documentId: string, action: ReviewAction, note?: string): Promise<ActionState> {
  const actor = await requireStaffActor();
  try {
    await reviewDocument(getDb(), actor, documentId, action, note);
  } catch (error) {
    return errorState(error);
  }
  refreshStaff();
  const msg: Record<ReviewAction, string> = {
    start_review: "Marked under review.",
    verify: "Document verified.",
    reject: "Document rejected. The client can see the reason and send a new copy.",
    request_replacement: "Replacement requested from the client.",
  };
  return { status: "success", message: msg[action] };
}

export async function setDocumentVisibilityAction(documentId: string, visibility: DocumentVisibility): Promise<ActionState> {
  const actor = await requireStaffActor();
  try {
    await setDocumentVisibility(getDb(), actor, documentId, visibility);
  } catch (error) {
    return errorState(error);
  }
  refreshStaff();
  return { status: "success", message: visibility === "internal_only" ? "Document is now internal only." : "Document shared with the client." };
}

export async function archiveDocumentByIdAction(documentId: string): Promise<ActionState> {
  const actor = await requireStaffActor();
  try {
    await archiveDocument(getDb(), actor, documentId);
  } catch (error) {
    return errorState(error);
  }
  refreshStaff();
  return { status: "success", message: "Document archived." };
}

/* ───────── Requests ───────── */

/**
 * Items arrive as parallel fields item_title[], item_category[], item_required[] (index-matched),
 * item_description[]. The required checkbox posts the item's index.
 */
export async function createDocumentRequestAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireStaffActor();
  const clientId = str(formData, "clientId");
  try {
    const titles = formData.getAll("item_title").map(String);
    const cats = formData.getAll("item_category").map(String);
    const descs = formData.getAll("item_description").map(String);
    const required = new Set(formData.getAll("item_required").map(String));
    const items = titles
      .map((title, i) => ({ title, category: cats[i] || "other", description: descs[i] ?? "", required: required.has(String(i)) }))
      .filter((it) => it.title.trim());
    await createDocumentRequest(getDb(), actor, {
      clientId,
      title: str(formData, "title"),
      description: str(formData, "description"),
      engagementId: str(formData, "engagementId"),
      taxPreparationCaseId: str(formData, "taxPreparationCaseId"),
      dueDate: str(formData, "dueDate"),
      send: formData.get("send") === "on",
      items,
    });
  } catch (error) {
    return errorState(error, formData);
  }
  refreshStaff(clientId);
  return { status: "success", message: formData.get("send") === "on" ? "Request sent. The client sees it in their portal." : "Request saved as a draft." };
}

export async function sendDocumentRequestAction(requestId: string): Promise<ActionState> {
  const actor = await requireStaffActor();
  try {
    await sendDocumentRequest(getDb(), actor, requestId);
  } catch (error) {
    return errorState(error);
  }
  refreshStaff();
  return { status: "success", message: "Request sent. The client sees it in their portal (no email is sent)." };
}

export async function cancelDocumentRequestAction(requestId: string): Promise<ActionState> {
  const actor = await requireStaffActor();
  try {
    await cancelDocumentRequest(getDb(), actor, requestId);
  } catch (error) {
    return errorState(error);
  }
  refreshStaff();
  return { status: "success", message: "Request cancelled." };
}

export async function waiveRequestItemAction(itemId: string): Promise<ActionState> {
  const actor = await requireStaffActor();
  try {
    await waiveRequestItem(getDb(), actor, itemId);
  } catch (error) {
    return errorState(error);
  }
  refreshStaff();
  return { status: "success", message: "Marked as not needed." };
}

/* ───────── Portal ───────── */

/** Client uploads a file for a requested item (the item is validated against the server-resolved client). */
export async function portalRequestUploadAction(itemId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requirePortalContext();
  try {
    await uploadDocument(getDb(), ctx.actor, { clientId: ctx.client.clientId, requestItemId: itemId, ...(await fileFromForm(formData)) });
  } catch (error) {
    return errorState(error);
  }
  revalidatePath("/portal", "layout");
  return { status: "success", message: "Thanks — your file was uploaded securely. We’ll review it." };
}

/** Client sends a new copy of a document the firm sent back. */
export async function portalReplaceDocumentAction(documentId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requirePortalContext();
  try {
    await uploadNewVersion(getDb(), ctx.actor, documentId, await fileFromForm(formData), {}, ctx.client.clientId);
  } catch (error) {
    return errorState(error);
  }
  revalidatePath("/portal", "layout");
  return { status: "success", message: "Thanks — your new copy was uploaded. We’ll review it." };
}
