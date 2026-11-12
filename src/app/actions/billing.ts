"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { errorState, type ActionState } from "@/lib/action-state";
import { requireStaffActor, setSessionCookie } from "@/lib/auth/current";
import { createSession } from "@/lib/auth/sessions";
import { cancelFirmSubscription, startFirmCheckout, syncFirmBilling } from "@/services/firm-billing";
import { SignupRejectedError, signUpFirm } from "@/services/signup";

const appBase = () => (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

/** "Subscribe monthly / yearly": sends the firm admin to PayPal to approve. Allowed while locked. */
export async function startFirmCheckoutAction(interval: "month" | "year", _prev: ActionState, _formData: FormData): Promise<ActionState> {
  const actor = await requireStaffActor({ allowLocked: true });
  let url: string;
  try {
    url = await startFirmCheckout(getDb(), actor, interval, {
      // PayPal sends the admin back to the dashboard with the subscription modal open.
      returnUrl: `${appBase()}/staff?subscription=1&subscribed=1`,
      cancelUrl: `${appBase()}/staff?subscription=1&subscribed=0`,
    });
  } catch (error) {
    return errorState(error);
  }
  redirect(url);
}

/** Re-checks the firm's subscription with PayPal now (after returning from checkout). */
export async function refreshFirmBillingAction(): Promise<void> {
  const actor = await requireStaffActor({ allowLocked: true });
  await syncFirmBilling(getDb(), actor.firmId, { force: true });
  revalidatePath("/staff", "layout");
}

export async function cancelFirmSubscriptionAction(_prev: ActionState, _formData: FormData): Promise<ActionState> {
  const actor = await requireStaffActor({ allowLocked: true });
  try {
    await cancelFirmSubscription(getDb(), actor);
  } catch (error) {
    return errorState(error);
  }
  revalidatePath("/staff", "layout");
  return { status: "success", message: "Your subscription is cancelled. No further payments will be taken; you keep access until the end of the paid period." };
}

/* ───────── Sign-up ───────── */

/** Best-effort per-IP limit (in memory, per server instance): 5 sign-ups / hour. */
const hits = new Map<string, number[]>();
function allow(ip: string, now = Date.now()): boolean {
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 3600_000);
  if (recent.length >= 5) return false;
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 10_000) hits.clear();
  return true;
}

export async function signUpAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const h = await headers();
    const ip = (h.get("x-forwarded-for") ?? "").split(",")[0]!.trim() || h.get("x-real-ip") || "unknown";
    if (!allow(ip)) throw new SignupRejectedError();
    const db = getDb();
    // Read fields explicitly: formValues() deliberately drops password fields (so they're never echoed back).
    const field = (k: string) => (typeof formData.get(k) === "string" ? (formData.get(k) as string) : "");
    const actor = await signUpFirm(db, {
      firmName: field("firmName"),
      name: field("name"),
      email: field("email"),
      password: field("password"),
      confirmPassword: field("confirmPassword"),
      terms: field("terms"),
      website: field("website"),
      startedAt: field("startedAt"),
    });
    const { token } = await createSession(db, actor.userId);
    await setSessionCookie(token);
  } catch (error) {
    // errorState never echoes passwords back.
    return errorState(error, formData);
  }
  redirect("/staff?welcome=1");
}
