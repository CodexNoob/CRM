import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { Alert } from "@/components/ui";
import { hasAnyUsers, isSetupCodeConfigured, MIN_SETUP_CODE_LENGTH } from "@/services/setup";
import { SetupForm } from "./setup-form";

export const metadata: Metadata = { title: "Set up your firm" };
export const dynamic = "force-dynamic";

export default async function SetupPage() {
  // Once any account exists this page is gone for good.
  if (await hasAnyUsers(getDb())) notFound();
  const configured = isSetupCodeConfigured(process.env.SETUP_CODE);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Set up your firm</h1>
      <p className="mt-1 mb-6 text-sm text-muted">
        Create the first administrator account. You can invite the rest of your team from the Team page afterwards.
      </p>
      {configured ? (
        <SetupForm />
      ) : (
        <Alert tone="warning">
          Setup is not enabled on this server yet. Add a <code>SETUP_CODE</code> of at least {MIN_SETUP_CODE_LENGTH} random characters to the server’s
          environment (for local development, <code>.env.local</code>), restart the app, and reload this page.
        </Alert>
      )}
    </main>
  );
}
