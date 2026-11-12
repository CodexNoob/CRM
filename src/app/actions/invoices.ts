"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { errorState, formValues, type ActionState } from "@/lib/action-state";
import { requireClientActor, requireStaffActor } from "@/lib/auth/current";
import { formatMoney } from "@/lib/labels";
import { cancelInvoice, createInvoice, refreshInvoice, sendInvoice } from "@/services/invoices";
import { getPublicProfile } from "@/services/settings";
import { cancelSubscription, createSubscriptionPlan, refreshSubscription, startPortalSubscription } from "@/services/subscriptions";

function revalidateInvoices(clientId: string) {
  revalidatePath(`/staff/clients/${clientId}`);
  revalidatePath("/staff/invoices");
  revalidatePath("/portal/invoices");
}

export async function createInvoiceAction(clientId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireStaffActor();
  let message: string;
  try {
    const inv = await createInvoice(getDb(), actor, clientId, formValues(formData));
    message = `Invoice ${inv.paypalInvoiceNumber ?? ""} for ${formatMoney(inv.totalCents, inv.currency)} was sent to ${inv.recipientEmail}.`.replace("  ", " ");
  } catch (error) {
    revalidateInvoices(clientId); // a draft may have been saved even if sending failed
    return errorState(error, formData);
  }
  revalidateInvoices(clientId);
  return { status: "success", message };
}

/** Row actions on an invoice: send (retry a draft), refresh status, cancel. */
export async function invoiceRowAction(id: string, clientId: string, op: "send" | "refresh" | "cancel"): Promise<ActionState> {
  const actor = await requireStaffActor();
  try {
    if (op === "send") await sendInvoice(getDb(), actor, id);
    else if (op === "refresh") await refreshInvoice(getDb(), actor, id);
    else await cancelInvoice(getDb(), actor, id);
  } catch (error) {
    return errorState(error);
  } finally {
    revalidateInvoices(clientId);
  }
  const messages = { send: "Invoice sent.", refresh: "Status updated from PayPal.", cancel: "Invoice cancelled. PayPal has notified the client." };
  return { status: "success", message: messages[op] };
}

/* ───────── Subscriptions ───────── */

export async function createSubscriptionAction(clientId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireStaffActor();
  let message: string;
  try {
    const sub = await createSubscriptionPlan(getDb(), actor, clientId, formValues(formData));
    message = `Subscription "${sub.name}" (${formatMoney(sub.amountCents, sub.currency)} per ${sub.interval}) is ready. The client will see a Subscribe button in their portal.`;
  } catch (error) {
    return errorState(error, formData);
  }
  revalidateInvoices(clientId);
  return { status: "success", message };
}

export async function subscriptionRowAction(id: string, clientId: string, op: "refresh" | "cancel"): Promise<ActionState> {
  const actor = await requireStaffActor();
  try {
    if (op === "refresh") await refreshSubscription(getDb(), actor, id);
    else await cancelSubscription(getDb(), actor, id);
  } catch (error) {
    return errorState(error);
  } finally {
    revalidateInvoices(clientId);
  }
  return { status: "success", message: op === "refresh" ? "Status updated from PayPal." : "Subscription cancelled. No further payments will be taken." };
}

/** Portal "Subscribe" button: sends the client to PayPal to approve the subscription. */
export async function portalSubscribeAction(id: string, _prev: ActionState, _formData: FormData): Promise<ActionState> {
  const actor = await requireClientActor();
  let approveUrl: string;
  try {
    const db = getDb();
    const profile = await getPublicProfile(db);
    const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
    approveUrl = await startPortalSubscription(db, actor, id, {
      returnUrl: `${base}/portal/invoices?subscribed=1`,
      cancelUrl: `${base}/portal/invoices?subscribed=0`,
      brandName: profile.name,
    });
  } catch (error) {
    return errorState(error);
  }
  redirect(approveUrl);
}
