import type { Metadata } from "next";
import Link from "next/link";
import { Alert, ButtonLink } from "@/components/ui";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = { title: "Reset password", referrer: "no-referrer", robots: { index: false, follow: false } };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4 py-10">
      <Link href="/login" className="mb-6 inline-flex min-h-10 items-center gap-1 self-start rounded-md text-sm text-muted hover:text-ink">
        <span aria-hidden>←</span> Back to sign in
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">Reset your password</h1>
      <p className="mt-1 mb-6 text-sm text-muted">Choose a new password with at least 12 characters.</p>
      {token ? (
        <ResetPasswordForm token={token} />
      ) : (
        <div className="space-y-4">
          <Alert tone="error">This reset link is missing its token. Request a new password reset link.</Alert>
          <ButtonLink href="/forgot-password" variant="secondary">Request a new link</ButtonLink>
        </div>
      )}
    </main>
  );
}
