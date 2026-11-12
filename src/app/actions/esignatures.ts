"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { errorState, type ActionState } from "@/lib/action-state";
import { requireStaffActor } from "@/lib/auth/current";
import { requirePortalContext } from "@/lib/auth/portal-context";
import { createSignatureDraft, portalSigningUrl, sendSignatureRequest, voidSignatureRequest } from "@/services/esignatures";

/** Signers arrive as signer{i}Name / signer{i}Email / signer{i}Role / signer{i}Order (i = 0..9). */
function readDraft(formData: FormData) {
  const s = (k: string) => (typeof formData.get(k) === "string" ? (formData.get(k) as string) : "");
  const signers = [];
  for (let i = 0; i < 10; i++) {
    const name = s(`signer${i}Name`).trim();
    const email = s(`signer${i}Email`).trim();
    if (!name && !email) continue;
    signers.push({ name, email, role: s(`signer${i}Role`), order: s(`signer${i}Order`) || String(i + 1) });
  }
  return {
    title: s("title"),
    message: s("message"),
    documentType: s("documentType") || "other",
    clientId: s("clientId"),
    engagementId: s("engagementId"),
    taxReturnId: s("taxReturnId"),
    documentId: s("documentId"),
    expiresInDays: s("expiresInDays"),
    signers,
  };
}

export async function createSignatureDraftAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireStaffActor();
  let id: string;
  try {
    id = (await createSignatureDraft(getDb(), actor, readDraft(formData))).id;
  } catch (error) {
    return errorState(error, formData);
  }
  revalidatePath("/staff/e-signatures");
  redirect(`/staff/e-signatures/${id}?created=1`);
}

export async function sendSignatureAction(id: string): Promise<ActionState> {
  const actor = await requireStaffActor();
  try {
    await sendSignatureRequest(getDb(), actor, id);
  } catch (error) {
    return errorState(error);
  }
  revalidatePath("/staff/e-signatures", "layout");
  return { status: "success", message: "Sent through Dropbox Sign. Signers receive the invitation from Dropbox Sign." };
}

export async function voidSignatureAction(id: string): Promise<ActionState> {
  const actor = await requireStaffActor();
  try {
    await voidSignatureRequest(getDb(), actor, id);
  } catch (error) {
    return errorState(error);
  }
  revalidatePath("/staff/e-signatures", "layout");
  return { status: "success", message: "Request voided." };
}

/** Portal: opens the provider-hosted signing page for the user's own signature. */
export async function openSigningAction(signerId: string): Promise<ActionState> {
  const ctx = await requirePortalContext();
  let url: string;
  try {
    url = await portalSigningUrl(getDb(), ctx.actor, ctx.client.clientId, signerId);
  } catch (error) {
    return errorState(error);
  }
  return { status: "success", data: { url } };
}
