"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getDb } from "@/db";
import { errorState, formValues, type ActionState } from "@/lib/action-state";
import type { Actor } from "@/lib/auth/actor";
import { PORTAL_CLIENT_COOKIE, requirePortalContext } from "@/lib/auth/portal-context";
import { markPortalNotificationsRead } from "@/services/client-notifications";
import { requestContactChange, updatePortalUserName } from "@/services/portal";
import { assertPortalClientAccess } from "@/services/portal-access";
import { setTaskStatus } from "@/services/tasks";

/**
 * Portal actions. The client is ALWAYS the one resolved on the server (requirePortalContext);
 * nothing in the form or URL can change which client a request acts for.
 */

/** Some services authorize portal users by `actor.clientId`; give them the server-resolved client. */
function scoped(actor: Actor, clientId: string): Actor {
  return { ...actor, clientId };
}

export async function completeClientTaskAction(taskId: string, _prev: ActionState, _formData: FormData): Promise<ActionState> {
  const { actor, client } = await requirePortalContext();
  try {
    await setTaskStatus(getDb(), scoped(actor, client.clientId), taskId, "completed");
  } catch (error) {
    return errorState(error);
  }
  revalidatePath("/portal", "layout");
  return { status: "success", message: "Marked as done." };
}

/** Client switcher: only a client this user may access is accepted (otherwise nothing changes). */
export async function switchPortalClientAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { actor } = await requirePortalContext();
  const requested = formData.get("clientId");
  try {
    if (typeof requested !== "string") throw new Error("missing");
    await assertPortalClientAccess(getDb(), actor, requested);
  } catch {
    return { status: "error", message: "That account isn’t available." };
  }
  (await cookies()).set(PORTAL_CLIENT_COOKIE, requested, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 90 });
  revalidatePath("/portal", "layout");
  return { status: "success" };
}

export async function markPortalNotificationsReadAction(): Promise<void> {
  const { actor, client } = await requirePortalContext();
  await markPortalNotificationsRead(getDb(), actor, "all", client.clientId);
  revalidatePath("/portal", "layout");
}

export async function updatePortalNameAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { actor } = await requirePortalContext();
  try {
    await updatePortalUserName(getDb(), actor, formValues(formData));
  } catch (error) {
    return errorState(error, formData);
  }
  revalidatePath("/portal", "layout");
  return { status: "success", message: "Your name was updated." };
}

export async function requestContactChangeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { actor, client } = await requirePortalContext();
  try {
    await requestContactChange(getDb(), actor, client.clientId, formValues(formData));
  } catch (error) {
    return errorState(error, formData);
  }
  return { status: "success", message: "Thanks — the firm will verify and update your details." };
}
