"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { errorState, formValues, type ActionState } from "@/lib/action-state";
import { requireStaffActor } from "@/lib/auth/current";
import {
  approveTaxReturn,
  createTaxDocumentTemplate,
  createTaxPreparationCase,
  createTaxReturnFromPreparation,
  recordTaxAuthorityResponse,
  recordTaxAuthorization,
  recordTaxFiling,
  requestTaxReturnChanges,
  setTaxPreparationStatus,
  startTaxReturnReview,
  submitTaxReturnForReview,
  updateTaxChecklistItem,
  updateTaxReturnPreparationData,
} from "@/services/tax";

const PREPARATION_PATH = "/staff/tax-preparation";
const RETURNS_PATH = "/staff/tax-returns";

export async function createTaxPreparationCaseAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireStaffActor();
  let id: string;
  try {
    id = (await createTaxPreparationCase(getDb(), actor, formValues(formData))).id;
  } catch (error) {
    return errorState(error, formData);
  }
  revalidatePath(PREPARATION_PATH);
  redirect(`${PREPARATION_PATH}/${id}`);
}

export async function createTaxDocumentTemplateAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireStaffActor();
  try {
    await createTaxDocumentTemplate(getDb(), actor, formValues(formData));
  } catch (error) {
    return errorState(error, formData);
  }
  revalidatePath(PREPARATION_PATH);
  return { status: "success", message: "Document requirement saved for future cases." };
}

export async function setTaxPreparationStatusAction(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireStaffActor();
  try {
    await setTaxPreparationStatus(getDb(), actor, id, formValues(formData));
  } catch (error) {
    return errorState(error, formData);
  }
  revalidatePath(PREPARATION_PATH);
  revalidatePath(`${PREPARATION_PATH}/${id}`);
  revalidatePath(RETURNS_PATH);
  return { status: "success", message: "Preparation status saved." };
}

export async function updateTaxChecklistItemAction(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireStaffActor();
  let preparationCaseId: string;
  try {
    preparationCaseId = (await updateTaxChecklistItem(getDb(), actor, id, formValues(formData))).preparationCaseId;
  } catch (error) {
    return errorState(error, formData);
  }
  revalidatePath(PREPARATION_PATH);
  revalidatePath(`${PREPARATION_PATH}/${preparationCaseId}`);
  return { status: "success", message: "Document checklist updated." };
}

export async function createTaxReturnFromPreparationAction(id: string, _prev: ActionState, _formData: FormData): Promise<ActionState> {
  const actor = await requireStaffActor();
  let returnId: string;
  try {
    returnId = (await createTaxReturnFromPreparation(getDb(), actor, id)).id;
  } catch (error) {
    return errorState(error);
  }
  revalidatePath(PREPARATION_PATH);
  revalidatePath(RETURNS_PATH);
  redirect(`${RETURNS_PATH}/${returnId}`);
}

export async function submitTaxReturnForReviewAction(id: string, _prev: ActionState, _formData: FormData): Promise<ActionState> {
  const actor = await requireStaffActor();
  try {
    await submitTaxReturnForReview(getDb(), actor, id);
  } catch (error) {
    return errorState(error);
  }
  revalidatePath(RETURNS_PATH);
  revalidatePath(`${RETURNS_PATH}/${id}`);
  revalidatePath(PREPARATION_PATH);
  return { status: "success", message: "Return submitted for review." };
}

export async function updateTaxReturnPreparationDataAction(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireStaffActor();
  try {
    await updateTaxReturnPreparationData(getDb(), actor, id, formValues(formData));
  } catch (error) {
    return errorState(error, formData);
  }
  revalidatePath(RETURNS_PATH);
  revalidatePath(`${RETURNS_PATH}/${id}`);
  return { status: "success", message: "Tax preparation details saved." };
}

export async function startTaxReturnReviewAction(id: string, _prev: ActionState, _formData: FormData): Promise<ActionState> {
  const actor = await requireStaffActor();
  try {
    await startTaxReturnReview(getDb(), actor, id);
  } catch (error) {
    return errorState(error);
  }
  revalidatePath(RETURNS_PATH);
  revalidatePath(`${RETURNS_PATH}/${id}`);
  return { status: "success", message: "Review started." };
}

export async function requestTaxReturnChangesAction(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireStaffActor();
  try {
    await requestTaxReturnChanges(getDb(), actor, id, formValues(formData));
  } catch (error) {
    return errorState(error, formData);
  }
  revalidatePath(RETURNS_PATH);
  revalidatePath(`${RETURNS_PATH}/${id}`);
  revalidatePath(PREPARATION_PATH);
  return { status: "success", message: "Corrections requested." };
}

export async function approveTaxReturnAction(id: string, _prev: ActionState, _formData: FormData): Promise<ActionState> {
  const actor = await requireStaffActor();
  try {
    await approveTaxReturn(getDb(), actor, id);
  } catch (error) {
    return errorState(error);
  }
  revalidatePath(RETURNS_PATH);
  revalidatePath(`${RETURNS_PATH}/${id}`);
  return { status: "success", message: "Review approved; client authorization is still required." };
}

export async function recordTaxAuthorizationAction(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireStaffActor();
  try {
    await recordTaxAuthorization(getDb(), actor, id, formValues(formData));
  } catch (error) {
    return errorState(error, formData);
  }
  revalidatePath(RETURNS_PATH);
  revalidatePath(`${RETURNS_PATH}/${id}`);
  return { status: "success", message: "Client authorization outcome recorded." };
}

export async function recordTaxFilingAction(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireStaffActor();
  try {
    await recordTaxFiling(getDb(), actor, id, formValues(formData));
  } catch (error) {
    return errorState(error, formData);
  }
  revalidatePath(RETURNS_PATH);
  revalidatePath(`${RETURNS_PATH}/${id}`);
  return { status: "success", message: "Manual filing record saved. The return is not marked accepted." };
}

export async function recordTaxAuthorityResponseAction(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireStaffActor();
  try {
    await recordTaxAuthorityResponse(getDb(), actor, id, formValues(formData));
  } catch (error) {
    return errorState(error, formData);
  }
  revalidatePath(RETURNS_PATH);
  revalidatePath(`${RETURNS_PATH}/${id}`);
  return { status: "success", message: "Tax authority response recorded." };
}
