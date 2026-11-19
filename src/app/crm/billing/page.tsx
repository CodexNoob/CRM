import { redirect } from "next/navigation";
import { requireStaffActor } from "@/lib/auth/current";

/** The subscription is a modal now; old billing links open it on the dashboard. */
export default async function BillingPage({ searchParams }: { searchParams: Promise<{ subscribed?: string }> }) {
  const actor = await requireStaffActor({ allowLocked: true });
  if (actor.role !== "admin") redirect("/crm");
  const { subscribed } = await searchParams;
  redirect(subscribed === "1" || subscribed === "0" ? `/crm?subscription=1&subscribed=${subscribed}` : "/crm?subscription=1");
}
