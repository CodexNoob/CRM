"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { errorState, type ActionState } from "@/lib/action-state";
import { requireStaffActor } from "@/lib/auth/current";
import type { QboScope } from "@/integrations/qbo";
import { beginQboOAuth, disconnectQbo, linkQboCustomer, listQboCustomers, listQboItems, setQboDefaultItem, verifyQboConnection } from "@/services/qbo-connections";

function scopeFor(actor: Awaited<ReturnType<typeof requireStaffActor>>): QboScope {
  return { type: "firm", firmId: actor.firmId };
}

export async function connectQboAction(_previous: ActionState, _formData: FormData): Promise<ActionState> {
  const actor = await requireStaffActor({ allowLocked: true });
  let url: string;
  try {
    url = await beginQboOAuth(getDb(), actor, scopeFor(actor));
  } catch (error) {
    return errorState(error);
  }
  redirect(url);
}

export async function verifyQboAction(_previous: ActionState, _formData: FormData): Promise<ActionState> {
  const actor = await requireStaffActor({ allowLocked: true });
  try {
    const company = await verifyQboConnection(getDb(), actor, scopeFor(actor));
    revalidatePath("/staff/integrations");
    return { status: "success", message: `QuickBooks connection verified for ${company}.` };
  } catch (error) {
    return errorState(error);
  }
}

export async function disconnectQboAction(_previous: ActionState, _formData: FormData): Promise<ActionState> {
  const actor = await requireStaffActor({ allowLocked: true });
  try {
    await disconnectQbo(getDb(), actor, scopeFor(actor));
    revalidatePath("/staff/integrations");
    return { status: "success", message: "QuickBooks connection removed from this CRM." };
  } catch (error) {
    return errorState(error);
  }
}

export async function listQboCustomersAction() {
  const actor = await requireStaffActor({ allowLocked: true });
  try {
    return { status: "success" as const, customers: await listQboCustomers(getDb(), actor, scopeFor(actor)) };
  } catch (error) {
    return { status: "error" as const, message: error instanceof Error ? error.message : "Could not load QuickBooks customers." };
  }
}

export async function listQboItemsAction() {
  const actor = await requireStaffActor({ allowLocked: true });
  try {
    return { status: "success" as const, items: await listQboItems(getDb(), actor, scopeFor(actor)) };
  } catch (error) {
    return { status: "error" as const, message: error instanceof Error ? error.message : "Could not load QuickBooks service items." };
  }
}

export async function setQboDefaultItemAction(itemId: string): Promise<ActionState> {
  const actor = await requireStaffActor({ allowLocked: true });
  try {
    await setQboDefaultItem(getDb(), actor, scopeFor(actor), itemId);
    revalidatePath("/staff/integrations");
    revalidatePath("/staff/invoices");
    return { status: "success", message: "QuickBooks service item saved." };
  } catch (error) {
    return errorState(error);
  }
}

export async function linkQboCustomerAction(clientId: string, customerId: string): Promise<ActionState> {
  const actor = await requireStaffActor({ allowLocked: true });
  try {
    await linkQboCustomer(getDb(), actor, { type: "firm", firmId: actor.firmId }, clientId, customerId);
    revalidatePath(`/staff/clients/${clientId}`);
    return { status: "success", message: "QuickBooks customer matched to this client." };
  } catch (error) {
    return errorState(error);
  }
}
