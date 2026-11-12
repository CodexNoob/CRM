import type { Metadata } from "next";
import { getDb } from "@/db";
import { Card, PageHeader } from "@/components/ui";
import { requirePortalContext } from "@/lib/auth/portal-context";
import { getPortalProfile } from "@/services/portal";
import { ContactChangeForm, NameForm } from "./profile-forms";

export const metadata: Metadata = { title: "My Profile" };
export const dynamic = "force-dynamic";

export default async function PortalProfilePage() {
  const { actor, client, clients } = await requirePortalContext();
  const profile = await getPortalProfile(getDb(), actor, client.clientId);

  return (
    <>
      <PageHeader title="My Profile" description="Your sign-in details and the contact information the firm has on file." />
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="You">
          <dl className="mb-4 space-y-2 text-sm">
            <div>
              <dt className="text-xs text-muted">Sign-in email</dt>
              <dd className="break-all text-ink">{profile.email}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Accounts you can access</dt>
              <dd className="text-ink">{clients.map((c) => c.name).join(", ")}</dd>
            </div>
          </dl>
          <NameForm name={profile.name} />
          <p className="mt-4 text-xs text-muted">
            To change your sign-in email, ask the firm — for your security, staff verify email changes before they take effect.
          </p>
        </Card>
        <Card title={`Contact details for ${profile.client.name}`}>
          <dl className="mb-4 space-y-2 text-sm">
            <div>
              <dt className="text-xs text-muted">Phone</dt>
              <dd className="text-ink">{profile.client.phone || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Email</dt>
              <dd className="break-all text-ink">{profile.client.email || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Address</dt>
              <dd className="whitespace-pre-line text-ink">{profile.client.address || "—"}</dd>
            </div>
          </dl>
          <p className="mb-3 text-xs text-muted">Changes are sent to the firm, which verifies them before updating your record.</p>
          <ContactChangeForm />
        </Card>
        <Card title="Notifications" className="md:col-span-2">
          <p className="text-sm text-muted">
            Updates about requests, documents, messages and invoices appear in the portal (the bell at the top). The firm hasn’t enabled email notifications, so
            nothing is sent to your inbox from here.
          </p>
        </Card>
      </div>
    </>
  );
}
