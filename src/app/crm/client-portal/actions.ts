"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { errorState, formValues, type ActionState } from "@/lib/action-state";
import { requireStaffActor } from "@/lib/auth/current";
import { NotFoundError } from "@/lib/errors";
import { isUuid } from "@/lib/validation";
import { grantPortalAccess, setPortalAccessStatus } from "@/services/portal-access";
import { createPortalInvitation } from "@/services/users";

const linkFor = (token: string) => `${(process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "")}/setup-password?token=${encodeURIComponent(token)}`;
const INVITE_NOTE = "Send this link through a trusted channel. It works once and expires in 72 hours.";

function refresh(clientId?: string) {
  revalidatePath("/crm/client-portal");
  if (clientId) revalidatePath(`/crm/clients/${clientId}`);
}

/** Invite a contact (new or existing portal login of this firm) to a client's portal. */
export async function invitePortalContactAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireStaffActor();
  const values = formValues(formData);
  try {
    const { token } = await createPortalInvitation(getDb(), actor, String(values.clientId ?? ""), values);
    refresh(values.clientId);
    return { status: "success", message: `Invitation created. ${INVITE_NOTE}`, data: { link: linkFor(token) } };
  } catch (error) {
    return errorState(error, formData);
  }
}

/** New one-time sign-in link for an existing portal login (e.g. never set up, or forgot password). */
export async function reissuePortalLinkAction(userId: string, clientId: string): Promise<ActionState> {
  const actor = await requireStaffActor();
  try {
    if (!isUuid(userId)) throw new NotFoundError();
    const [u] = await getDb().select({ name: users.name, email: users.email }).from(users).where(and(eq(users.id, userId), eq(users.firmId, actor.firmId), eq(users.role, "client")));
    if (!u) throw new NotFoundError();
    const { token } = await createPortalInvitation(getDb(), actor, clientId, { name: u.name, email: u.email });
    refresh(clientId);
    return { status: "success", message: `New sign-in link created. ${INVITE_NOTE}`, data: { link: linkFor(token) } };
  } catch (error) {
    return errorState(error);
  }
}

export async function setPortalAccessAction(userId: string, clientId: string, status: "active" | "suspended"): Promise<ActionState> {
  const actor = await requireStaffActor();
  try {
    await setPortalAccessStatus(getDb(), actor, { userId, clientId, status });
  } catch (error) {
    return errorState(error);
  }
  refresh(clientId);
  return { status: "success", message: status === "suspended" ? "Portal access suspended for this client." : "Portal access restored." };
}

/** Give an existing portal login access to another client of the firm. */
export async function grantPortalAccessAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireStaffActor();
  const v = formValues(formData);
  try {
    const role = v.role === "owner" || v.role === "viewer" ? v.role : "contact";
    await grantPortalAccess(getDb(), actor, { userId: String(v.userId ?? ""), clientId: String(v.clientId ?? ""), role });
  } catch (error) {
    return errorState(error, formData);
  }
  refresh(v.clientId);
  return { status: "success", message: "Access granted. The person can switch to this client in their portal." };
}
