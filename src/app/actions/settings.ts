"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { errorState, formValues, type ActionState } from "@/lib/action-state";
import { requireStaffActor } from "@/lib/auth/current";
import { createAnnouncement, saveFirmProfile, setAnnouncementPublished } from "@/services/settings";

/** Settings changes update the public website, so its cached page is refreshed too. */
function refresh() {
  revalidatePath("/staff/settings");
  revalidatePath("/");
}

export async function saveFirmProfileAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireStaffActor();
  try {
    await saveFirmProfile(getDb(), actor, formValues(formData));
  } catch (error) {
    return errorState(error, formData);
  }
  refresh();
  return { status: "success", message: "Saved. The website now shows these details." };
}

export async function createAnnouncementAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireStaffActor();
  try {
    await createAnnouncement(getDb(), actor, formValues(formData));
  } catch (error) {
    return errorState(error, formData);
  }
  refresh();
  return { status: "success", message: "Announcement published on the website." };
}

export async function toggleAnnouncementAction(id: string, published: boolean, _prev: ActionState, _formData: FormData): Promise<ActionState> {
  const actor = await requireStaffActor();
  try {
    await setAnnouncementPublished(getDb(), actor, id, published === true);
  } catch (error) {
    return errorState(error);
  }
  refresh();
  return { status: "success" };
}
