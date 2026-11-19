"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { errorState, type ActionState } from "@/lib/action-state";
import { requireStaffActor, setSessionCookie } from "@/lib/auth/current";
import { ForbiddenError, IntegrationNotConfiguredError } from "@/lib/errors";
import { createSession } from "@/lib/auth/sessions";
import { cancelFirmSubscription, cancelPendingFirmCheckout, startFirmCheckout, syncFirmBilling } from "@/services/firm-billing";
import { SignupRejectedError, signUpFirm } from "@/services/signup";

function appBase(): string {
  const configured = process.env.APP_URL?.trim();
  if (!configured) throw new IntegrationNotConfiguredError("PayPal", "Set APP_URL to the canonical public CRM origin.");
  try {
    const url = new URL(configured);
    if (url.pathname !== "/" || url.search || url.hash) throw new Error();
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) throw new Error();
    return url.origin;
  } catch {
    throw new IntegrationNotConfiguredError("PayPal", "APP_URL must be the canonical public HTTPS origin.");
  }
}

/** Starts PayPal checkout for the firm subscription. Allowed while locked. */
export async function startFirmCheckoutAction(interval: "month" | "year", _prev: ActionState, _formData: FormData): Promise<ActionState> {
  const actor = await requireStaffActor({ allowLocked: true });
  let url: string;
  try {
    const base = appBase();
    url = await startFirmCheckout(getDb(), actor, interval, {
      returnUrl: `${base}/crm?subscription=1&subscribed=1`,
      cancelUrl: `${base}/crm?subscription=1&subscribed=0`,
    });
  } catch (error) {
    return errorState(error);
  }
  redirect(url);
}

/** Re-checks the firm's subscription status with PayPal. */
export async function refreshFirmBillingAction(): Promise<void> {
  const actor = await requireStaffActor({ allowLocked: true });
  if (actor.role !== "admin") throw new ForbiddenError("Only the firm Owner can access billing.");
  await syncFirmBilling(getDb(), actor.firmId, { force: true });
  revalidatePath("/crm", "layout");
}

export async function cancelFirmSubscriptionAction(_prev: ActionState, _formData: FormData): Promise<ActionState> {
  const actor = await requireStaffActor({ allowLocked: true });
  try {
    await cancelFirmSubscription(getDb(), actor);
  } catch (error) {
    revalidatePath("/crm", "layout");
    return errorState(error);
  }
  revalidatePath("/crm", "layout");
  return { status: "success", message: "PayPal renewal is cancelled. Any paid access remains available until its end date." };
}

export async function cancelPendingFirmCheckoutAction(): Promise<ActionState> {
  const actor = await requireStaffActor({ allowLocked: true });
  try {
    await cancelPendingFirmCheckout(getDb(), actor);
  } catch (error) {
    return errorState(error);
  }
  revalidatePath("/crm", "layout");
  return { status: "success", message: "Pending PayPal checkout cancelled." };
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
  redirect("/crm?welcome=1");
}
