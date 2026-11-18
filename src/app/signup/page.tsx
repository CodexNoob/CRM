import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { product } from "@/content/product";
import { getCurrentActor } from "@/lib/auth/current";
import { formatMoney } from "@/lib/labels";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = { title: `Start your free trial | ${product.name}` };
export const dynamic = "force-dynamic";

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ plan?: string }> }) {
  const actor = await getCurrentActor();
  if (actor) redirect(actor.role === "client" ? "/portal" : "/crm");
  const { plan } = await searchParams;
  const chosen = plan === "month" || plan === "year" ? product.plans[plan] : null;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
      <Link href="/" className="mb-6 inline-flex min-h-10 items-center gap-1 self-start rounded-md text-sm text-muted hover:text-ink">
        <span aria-hidden>←</span> Back to home
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">Start your {product.trialDays}-day free trial</h1>
      <p className="mt-1 mb-6 text-sm text-muted">
        No card needed. You’ll get your own private workspace right away.
        {chosen ? ` After the trial: ${formatMoney(chosen.amountCents)} / ${chosen.per}.` : ""}
      </p>
      <SignupForm />
      <p className="mt-4 text-center text-sm text-muted">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-brand-ink hover:underline">Sign in</Link>
      </p>
    </main>
  );
}
