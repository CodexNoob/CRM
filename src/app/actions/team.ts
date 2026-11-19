"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { errorState, formValues, type ActionState } from "@/lib/action-state";
import { requireStaffActor } from "@/lib/auth/current";
import { getFirm, resolveFirmContext } from "@/services/firms";
import { changeStaffRole, inviteStaff, sendStaffSignInLink, setStaffActive } from "@/services/team";
import { sendStaffInvitationEmail } from "@/services/notifications";

function signInLink(token: string): string {
  const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return `${base}/setup-password?token=${encodeURIComponent(token)}`;
}

const DELIVERY_ERROR = "The account was created, but the invitation email could not be sent. Check the email provider settings, then use the member row's password setup email action to retry.";

export async function inviteStaffAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const signedInActor = await requireStaffActor();
  try {
    const db = getDb();
    const actor = await resolveFirmContext(db, signedInActor, String(formData.get("firmId") ?? ""));
    const values = formValues(formData);
    const firm = await getFirm(db, actor.firmId);
    const { token } = await inviteStaff(db, actor, values);
    const email = String(values.email ?? "").trim().toLowerCase();
    const sent = await sendStaffInvitationEmail({ to: email, name: String(values.name ?? ""), firmName: firm.name, link: signInLink(token) });
    revalidatePath("/crm/team");
    if (!sent.ok) return { status: "error", message: `${DELIVERY_ERROR} (${sent.error}).`, values };
    return { status: "success", message: `Invitation email sent to ${email}. The one-time link expires in 72 hours.` };
  } catch (error) {
    return errorState(error, formData);
  }
}

export async function sendStaffLinkAction(userId: string, firmId: string, _prev: ActionState, _formData: FormData): Promise<ActionState> {
  const signedInActor = await requireStaffActor();
  try {
    const db = getDb();
    const actor = await resolveFirmContext(db, signedInActor, firmId);
    const firm = await getFirm(db, actor.firmId);
    const { token, name, email } = await sendStaffSignInLink(db, actor, userId);
    const sent = await sendStaffInvitationEmail({ to: email, name, firmName: firm.name, link: signInLink(token) });
    if (!sent.ok) return { status: "error", message: `New password setup link was created, but the email could not be sent (${sent.error}). Check the email provider settings and retry.` };
    return { status: "success", message: `Password setup email sent to ${email}. Earlier links no longer work; this link expires in 72 hours.` };
  } catch (error) {
    return errorState(error);
  }
}

export async function setStaffActiveAction(userId: string, active: boolean, firmId: string, _prev: ActionState, _formData: FormData): Promise<ActionState> {
  const signedInActor = await requireStaffActor();
  try {
    const actor = await resolveFirmContext(getDb(), signedInActor, firmId);
    await setStaffActive(getDb(), actor, userId, active === true);
  } catch (error) {
    return errorState(error);
  }
  revalidatePath("/crm/team");
  return { status: "success" };
}

export async function changeStaffRoleAction(userId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const signedInActor = await requireStaffActor();
  try {
    const actor = await resolveFirmContext(getDb(), signedInActor, String(formData.get("firmId") ?? ""));
    await changeStaffRole(getDb(), actor, userId, formData.get("role"));
  } catch (error) {
    return errorState(error);
  }
  revalidatePath("/crm/team");
  return { status: "success", message: "Role updated. They’ll need to sign in again." };
}
