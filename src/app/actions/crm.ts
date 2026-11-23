"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { errorState, formValues, type ActionState } from "@/lib/action-state";
import { requireStaffActor } from "@/lib/auth/current";
import {
  addOnboardingItem,
  archiveClientContact,
  saveClientContact,
  setClientArchived,
  setOnboardingItemStatus,
  updateClient,
} from "@/services/clients";
import { addLeadActivity, AlreadyConvertedError, convertLead, createLead, setLeadArchived, setLeadFollowUpDate, setLeadStatus, updateLead } from "@/services/leads";

/** formValues() plus multi-value fields (checkbox groups) as arrays. */
function formInput(formData: FormData, multi: string[] = []): Record<string, unknown> {
  const v: Record<string, unknown> = formValues(formData);
  for (const k of multi) v[k] = formData.getAll(k).filter((x): x is string => typeof x === "string");
  return v;
}

const refreshLeads = () => revalidatePath("/crm/leads", "layout");
const refreshClient = (id: string) => {
  revalidatePath(`/crm/clients/${id}`);
  revalidatePath("/crm/clients");
};

/* ───────── Leads ───────── */

export async function createLeadAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireStaffActor();
  let id: string;
  try {
    id = (await createLead(getDb(), actor, formInput(formData, ["requestedServices"]))).id;
  } catch (error) {
    return errorState(error, formData);
  }
  refreshLeads();
  redirect(`/crm/leads/${id}`);
}

export async function updateLeadAction(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireStaffActor();
  try {
    await updateLead(getDb(), actor, id, formInput(formData, ["requestedServices"]));
  } catch (error) {
    return errorState(error, formData);
  }
  refreshLeads();
  return { status: "success", message: "Lead saved." };
}

export async function setLeadStatusAction(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireStaffActor();
  try {
    await setLeadStatus(getDb(), actor, id, formValues(formData));
  } catch (error) {
    return errorState(error, formData);
  }
  refreshLeads();
  return { status: "success", message: "Stage updated." };
}

export async function setLeadFollowUpAction(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireStaffActor();
  const followUpDate = formData.get("clearFollowUp") === "true" ? "" : formData.get("followUpDate");
  try {
    await setLeadFollowUpDate(getDb(), actor, id, { followUpDate });
  } catch (error) {
    return errorState(error, formData);
  }
  refreshLeads();
  return {
    status: "success",
    message: followUpDate ? "Follow-up scheduled." : "Follow-up cleared.",
    data: { followUpDate: typeof followUpDate === "string" ? followUpDate : "" },
  };
}

/** Kanban / row-menu stage moves (no reason needed, except Lost which the UI asks for). */
export async function moveLeadAction(id: string, status: string, lostReason?: string): Promise<ActionState> {
  const actor = await requireStaffActor();
  try {
    await setLeadStatus(getDb(), actor, id, { status, lostReason });
  } catch (error) {
    return errorState(error);
  }
  refreshLeads();
  return { status: "success", message: "Stage updated." };
}

export async function addLeadActivityAction(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireStaffActor();
  try {
    await addLeadActivity(getDb(), actor, id, formValues(formData));
  } catch (error) {
    return errorState(error, formData);
  }
  refreshLeads();
  return { status: "success", message: "Activity recorded." };
}

export async function convertLeadAction(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireStaffActor();
  let clientId: string;
  try {
    clientId = (await convertLead(getDb(), actor, id, formValues(formData))).clientId;
  } catch (error) {
    if (error instanceof AlreadyConvertedError && error.clientId) {
      return { status: "error", message: "This lead was already converted. Open the client record instead.", data: { clientId: error.clientId } };
    }
    return errorState(error, formData);
  }
  refreshLeads();
  refreshClient(clientId);
  // Next step is up to the user: the client page offers "New engagement".
  redirect(`/crm/clients/${clientId}?converted=1`);
}

export async function archiveLeadAction(id: string, archived: boolean): Promise<ActionState> {
  const actor = await requireStaffActor();
  try {
    await setLeadArchived(getDb(), actor, id, archived);
  } catch (error) {
    return errorState(error);
  }
  refreshLeads();
  return { status: "success", message: archived ? "Lead archived." : "Lead restored." };
}

/* ───────── Clients ───────── */

export async function updateClientDetailsAction(clientId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireStaffActor();
  try {
    await updateClient(getDb(), actor, clientId, formValues(formData));
  } catch (error) {
    return errorState(error, formData);
  }
  refreshClient(clientId);
  return { status: "success", message: "Client saved." };
}

export async function archiveClientAction(clientId: string, archived: boolean): Promise<ActionState> {
  const actor = await requireStaffActor();
  try {
    await setClientArchived(getDb(), actor, clientId, archived);
  } catch (error) {
    return errorState(error);
  }
  refreshClient(clientId);
  return { status: "success", message: archived ? "Client archived." : "Client restored." };
}

export async function saveContactAction(clientId: string, contactId: string | null, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireStaffActor();
  try {
    await saveClientContact(getDb(), actor, clientId, contactId, formValues(formData));
  } catch (error) {
    return errorState(error, formData);
  }
  refreshClient(clientId);
  return { status: "success", message: "Contact saved." };
}

export async function removeContactAction(clientId: string, contactId: string): Promise<ActionState> {
  const actor = await requireStaffActor();
  try {
    await archiveClientContact(getDb(), actor, clientId, contactId);
  } catch (error) {
    return errorState(error);
  }
  refreshClient(clientId);
  return { status: "success", message: "Contact removed." };
}

export async function addOnboardingItemAction(clientId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireStaffActor();
  try {
    await addOnboardingItem(getDb(), actor, clientId, formValues(formData));
  } catch (error) {
    return errorState(error, formData);
  }
  refreshClient(clientId);
  return { status: "success", message: "Added to the onboarding checklist." };
}

export async function setOnboardingItemAction(clientId: string, itemId: string, status: "requested" | "received" | "verified" | "waived"): Promise<ActionState> {
  const actor = await requireStaffActor();
  try {
    await setOnboardingItemStatus(getDb(), actor, clientId, itemId, status);
  } catch (error) {
    return errorState(error);
  }
  refreshClient(clientId);
  return { status: "success", message: "Checklist updated." };
}
