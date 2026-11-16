"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { errorState, formValues, type ActionState } from "@/lib/action-state";
import { requireStaffActor } from "@/lib/auth/current";
import { resolveFirmContext } from "@/services/firms";
import { formatMoney } from "@/lib/labels";
import { cancelInvoice, createInvoice, refreshInvoice, sendInvoice } from "@/services/invoices";
import { cancelSubscription, createSubscriptionPlan, refreshSubscription } from "@/services/subscriptions";

function revalidateInvoices(clientId: string) {
  revalidatePath(`/staff/clients/${clientId}`);
  revalidatePath("/staff/invoices");
  revalidatePath("/portal/invoices");
}

export async function createInvoiceAction(clientId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const signedInActor = await requireStaffActor();
  let actor = signedInActor;
  let message: string;
  try {
    actor = await resolveFirmContext(getDb(), signedInActor, String(formData.get("firmId") ?? ""));
    const inv = await createInvoice(getDb(), actor, clientId, formValues(formData));
    message = `Invoice ${inv.qboInvoiceNumber ?? ""} for ${formatMoney(inv.totalCents, inv.currency)} was sent to ${inv.recipientEmail}.`.replace("  ", " ");
  } catch (error) {
    revalidateInvoices(clientId); // a draft may have been saved even if sending failed
    return errorState(error, formData);
  }
  revalidateInvoices(clientId);
  return { status: "success", message };
}

/** Row actions on an invoice: send (retry a draft), refresh status, cancel. */
export async function invoiceRowAction(id: string, clientId: string, op: "send" | "refresh" | "cancel", firmId?: string): Promise<ActionState> {
  const signedInActor = await requireStaffActor();
  let actor = signedInActor;
  try {
    actor = await resolveFirmContext(getDb(), signedInActor, firmId);
    if (op === "send") await sendInvoice(getDb(), actor, id);
    else if (op === "refresh") await refreshInvoice(getDb(), actor, id);
    else await cancelInvoice(getDb(), actor, id);
  } catch (error) {
    return errorState(error);
  } finally {
    revalidateInvoices(clientId);
  }
  const messages = { send: "Invoice sent through QuickBooks.", refresh: "Status updated from QuickBooks.", cancel: "Invoice voided in QuickBooks." };
  return { status: "success", message: messages[op] };
}

/* ───────── Subscriptions ───────── */

export async function createSubscriptionAction(clientId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const signedInActor = await requireStaffActor();
  let actor = signedInActor;
  let message: string;
  try {
    actor = await resolveFirmContext(getDb(), signedInActor, String(formData.get("firmId") ?? ""));
    const sub = await createSubscriptionPlan(getDb(), actor, clientId, formValues(formData));
    message = `Recurring invoice schedule "${sub.name}" (${formatMoney(sub.amountCents, sub.currency)} per ${sub.interval}) is active. The first invoice is due now.`;
  } catch (error) {
    return errorState(error, formData);
  }
  revalidateInvoices(clientId);
  return { status: "success", message };
}

export async function subscriptionRowAction(id: string, clientId: string, op: "refresh" | "cancel", firmId?: string): Promise<ActionState> {
  const signedInActor = await requireStaffActor();
  try {
    const actor = await resolveFirmContext(getDb(), signedInActor, firmId);
    if (op === "refresh") await refreshSubscription(getDb(), actor, id);
    else await cancelSubscription(getDb(), actor, id);
  } catch (error) {
    return errorState(error);
  } finally {
    revalidateInvoices(clientId);
  }
  return { status: "success", message: op === "refresh" ? "Schedule status checked." : "Recurring invoice schedule cancelled. Already-issued invoices remain payable in QuickBooks." };
}
