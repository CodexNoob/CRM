"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { errorState, formValues, type ActionState } from "@/lib/action-state";
import { requireStaffActor } from "@/lib/auth/current";
import { changeStaffRole, inviteStaff, sendStaffSignInLink, setStaffActive } from "@/services/team";

function signInLink(token: string): string {
  const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return `${base}/setup-password?token=${encodeURIComponent(token)}`;
}

const LINK_NOTE = "Send this link to them through a trusted channel. It works once and expires in 72 hours.";

export async function inviteStaffAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireStaffActor();
  try {
    const { token } = await inviteStaff(getDb(), actor, formValues(formData));
    revalidatePath("/staff/team");
    return { status: "success", message: `Invitation created. ${LINK_NOTE}`, data: { link: signInLink(token) } };
  } catch (error) {
    return errorState(error, formData);
  }
}

export async function sendStaffLinkAction(userId: string, _prev: ActionState, _formData: FormData): Promise<ActionState> {
  const actor = await requireStaffActor();
  try {
    const { token } = await sendStaffSignInLink(getDb(), actor, userId);
    return { status: "success", message: `New sign-in link created; earlier links no longer work. ${LINK_NOTE}`, data: { link: signInLink(token) } };
  } catch (error) {
    return errorState(error);
  }
}

export async function setStaffActiveAction(userId: string, active: boolean, _prev: ActionState, _formData: FormData): Promise<ActionState> {
  const actor = await requireStaffActor();
  try {
    await setStaffActive(getDb(), actor, userId, active === true);
  } catch (error) {
    return errorState(error);
  }
  revalidatePath("/staff/team");
  return { status: "success" };
}

export async function changeStaffRoleAction(userId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireStaffActor();
  try {
    await changeStaffRole(getDb(), actor, userId, formData.get("role"));
  } catch (error) {
    return errorState(error);
  }
  revalidatePath("/staff/team");
  return { status: "success", message: "Role updated. They’ll need to sign in again." };
}
