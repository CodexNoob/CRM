import { FileSignature } from "lucide-react";
import { EmptyState, Panel } from "@/components/ui";

/** Shown whenever the module can't be used yet — honest about what's missing; no create/send controls. */
export function SetupRequired({ isAdmin }: { isAdmin: boolean }) {
  const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return (
    <Panel title="Setup required">
      <EmptyState icon={<FileSignature />} title="E-signatures aren’t connected yet">
        Signature requests are sent and signed through Dropbox Sign, which provides the signing experience, the audit trail and the legally binding signature. Nothing can be sent — and nothing
        is marked signed — until it is connected.
      </EmptyState>
      {isAdmin ? (
        <ol className="mx-auto mt-2 max-w-xl list-decimal space-y-1.5 pl-5 text-[13px] text-ink">
          <li>Create a Dropbox Sign account (API plan) and copy your <strong>API key</strong>.</li>
          <li>
            Add <code>DROPBOX_SIGN_API_KEY=…</code> to <code>.env.local</code> (keep <code>DROPBOX_SIGN_TEST_MODE=1</code> while testing) and restart the app.
          </li>
          <li>
            In Dropbox Sign, set the account callback URL to <code>{base}/api/webhooks/dropbox-sign</code> (it must be reachable from the internet).
          </li>
          <li>Send a test request to yourself and confirm it shows as signed here.</li>
          <li>
            Then set <code>DROPBOX_SIGN_ENABLED=1</code> and <code>DROPBOX_SIGN_TEST_MODE=0</code> to send legally binding requests.
          </li>
        </ol>
      ) : (
        <p className="text-center text-[13px] text-muted">Ask your firm admin to connect Dropbox Sign.</p>
      )}
    </Panel>
  );
}

