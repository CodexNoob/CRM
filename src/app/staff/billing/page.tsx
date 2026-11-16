import { redirect } from "next/navigation";
import { requireStaffActor } from "@/lib/auth/current";

/** The subscription is a modal now; old billing links open it on the dashboard. */
export default async function BillingPage({ searchParams }: { searchParams: Promise<{ subscribed?: string }> }) {
  await requireStaffActor({ allowLocked: true });
  const { subscribed } = await searchParams;
  redirect(subscribed === "1" || subscribed === "0" ? `/staff?subscription=1&subscribed=${subscribed}` : "/staff?subscription=1");
}
