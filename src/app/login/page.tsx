import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { hasAnyUsers } from "@/services/setup";
import { getCurrentActor } from "@/lib/auth/current";
import { Alert } from "@/components/ui";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ setup?: string; reset?: string }> }) {
  const actor = await getCurrentActor();
  if (actor) redirect(actor.role === "client" ? "/portal" : "/crm");
  const { setup, reset } = await searchParams;
  const firstRun = !(await hasAnyUsers(getDb()));

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4 py-10">
      <Link href="/" className="mb-6 inline-flex min-h-10 items-center gap-1 self-start rounded-md text-sm text-muted hover:text-ink">
        <span aria-hidden>←</span> Back to home
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
      <p className="mt-1 mb-6 text-sm text-muted">Staff and clients sign in here.</p>
      {setup === "done" ? (
        <div className="mb-4">
          <Alert tone="success">Your password is set. You can sign in now.</Alert>
        </div>
      ) : null}
      {reset === "done" ? (
        <div className="mb-4">
          <Alert tone="success">Your password has been reset. Sign in with your new password.</Alert>
        </div>
      ) : null}
      {firstRun ? (
        <div className="mb-4">
          <Alert tone="info">
            No accounts exist yet.{" "}
            <Link href="/setup" className="font-medium underline">
              Set up your firm’s first admin account
            </Link>
            .
          </Alert>
        </div>
      ) : null}
      <LoginForm />
      <p className="mt-4 text-center text-sm text-muted">
        New firm?{" "}
        <Link href="/signup" className="font-medium text-brand-ink hover:underline">
          Start a free trial
        </Link>
      </p>
      <p className="mt-6 text-xs text-muted">New client? Use the invitation link your firm sent you.</p>
    </main>
  );
}
