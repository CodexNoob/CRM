"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { errorState, formValues, type ActionState } from "@/lib/action-state";
import { requireStaffActor } from "@/lib/auth/current";
import { ValidationError } from "@/lib/errors";
import { resolveFirmContext } from "@/services/firms";
import {
  createAnnouncement,
  saveFirmProfile,
  savePlatformProfile,
  setAnnouncementPublished,
  setPlatformInquiryStatus,
  type LogoUpload,
} from "@/services/settings";

const MAX_LOGO_BYTES = 1_000_000;

async function readLogo(formData: FormData): Promise<LogoUpload | null | undefined> {
  if (formData.get("removeLogo") === "on") return null;
  const file = formData.get("logo");
  if (!(file instanceof File) || file.size === 0) return undefined;
  if (file.size > MAX_LOGO_BYTES) throw new ValidationError({ logo: ["Logo files must be 1 MB or smaller."] });
  const data = Buffer.from(await file.arrayBuffer());
  const isPng = data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const isJpeg = data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  if (isPng) return { data, contentType: "image/png" };
  if (isJpeg) return { data, contentType: "image/jpeg" };
  throw new ValidationError({ logo: ["Upload a PNG or JPEG logo."] });
}

function refreshOrganization() {
  revalidatePath("/staff/settings");
  revalidatePath("/staff");
  revalidatePath("/portal");
}

function refreshPlatform() {
  revalidatePath("/staff/platform-settings");
  revalidatePath("/");
}

export async function saveFirmProfileAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const signedInActor = await requireStaffActor();
    const actor = await resolveFirmContext(getDb(), signedInActor, String(formData.get("firmId") ?? ""));
    await saveFirmProfile(getDb(), actor, formValues(formData), await readLogo(formData));
  } catch (error) {
    return errorState(error, formData);
  }
  refreshOrganization();
  return { status: "success", message: "Organization profile saved." };
}

export async function savePlatformProfileAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireStaffActor();
    await savePlatformProfile(getDb(), actor, formValues(formData), await readLogo(formData));
  } catch (error) {
    return errorState(error, formData);
  }
  refreshPlatform();
  return { status: "success", message: "Platform profile saved." };
}

export async function updatePlatformInquiryStatusAction(id: string, status: "new" | "in_progress" | "resolved", _prev: ActionState, _formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireStaffActor();
    await setPlatformInquiryStatus(getDb(), actor, id, status);
  } catch (error) {
    return errorState(error);
  }
  revalidatePath("/staff/platform-settings");
  return { status: "success" };
}

export async function createAnnouncementAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const signedInActor = await requireStaffActor();
  try {
    const actor = await resolveFirmContext(getDb(), signedInActor, String(formData.get("firmId") ?? ""));
    await createAnnouncement(getDb(), actor, formValues(formData));
  } catch (error) {
    return errorState(error, formData);
  }
  refreshOrganization();
  return { status: "success", message: "Announcement added to the client portal." };
}

export async function toggleAnnouncementAction(id: string, published: boolean, firmId: string, _prev: ActionState, _formData: FormData): Promise<ActionState> {
  const signedInActor = await requireStaffActor();
  try {
    const actor = await resolveFirmContext(getDb(), signedInActor, firmId);
    await setAnnouncementPublished(getDb(), actor, id, published === true);
  } catch (error) {
    return errorState(error);
  }
  refreshOrganization();
  return { status: "success" };
}
