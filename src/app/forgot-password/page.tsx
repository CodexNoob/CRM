import type { Metadata } from "next";
import Link from "next/link";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = { title: "Forgot password", robots: { index: false, follow: false } };

export default function ForgotPasswordPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4 py-10">
      <Link href="/login" className="mb-6 inline-flex min-h-10 items-center gap-1 self-start rounded-md text-sm text-muted hover:text-ink">
        <span aria-hidden>←</span> Back to sign in
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">Forgot password?</h1>
      <p className="mt-1 mb-6 text-sm text-muted">Enter the email address for your account and we’ll send a reset link if it’s registered.</p>
      <ForgotPasswordForm />
    </main>
  );
}
