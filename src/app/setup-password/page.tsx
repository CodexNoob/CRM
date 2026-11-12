import type { Metadata } from "next";
import { Alert, ButtonLink } from "@/components/ui";
import { SetupPasswordForm } from "./setup-form";

export const metadata: Metadata = { title: "Set your password", referrer: "no-referrer" };

export default async function SetupPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Set your password</h1>
      <p className="mt-1 mb-6 text-sm text-muted">Choose a password of at least 12 characters. A short phrase works well.</p>
      {token ? (
        <SetupPasswordForm token={token} />
      ) : (
        <div className="space-y-4">
          <Alert tone="error">This link is missing its invitation code. Open the full link from your invitation.</Alert>
          <ButtonLink href="/login" variant="secondary">
            Go to sign in
          </ButtonLink>
        </div>
      )}
    </main>
  );
}
