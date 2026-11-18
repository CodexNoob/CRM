import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { SimpleTable, td } from "@/components/table";
import { Alert, Badge, PageHeader, Panel, TabNav } from "@/components/ui";
import { requireStaffActor } from "@/lib/auth/current";
import { FirmScopePicker } from "@/components/staff/firm-scope-picker";
import { MAX_FAILED_LOGINS, LOCKOUT_MS } from "@/lib/auth/login";
import { SESSION_ABSOLUTE_MS, SESSION_IDLE_MS } from "@/lib/auth/sessions";
import { formatDate } from "@/lib/labels";
import { firmToday } from "@/services/dashboard";
import { listPlatformFirms, resolveFirmContext } from "@/services/firms";
import { getOrganizationProfile, listAllAnnouncements } from "@/services/settings";
import { AnnouncementToggle, FirmProfileForm, NewAnnouncementForm } from "./settings-forms";

export const metadata: Metadata = { title: "Settings" };

const TABS = { profile: "Organization profile", website: "Client announcements", security: "Security" } as const;
type Tab = keyof typeof TABS;

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string; firmId?: string }> }) {
  const actor = await requireStaffActor();
  if (actor.role !== "admin" && actor.role !== "super_admin") notFound();
  const params = await searchParams;
  const requested = params.tab;
  const tab: Tab = requested && requested in TABS ? (requested as Tab) : "profile";
  const db = getDb();
  const scope = await resolveFirmContext(db, actor, params.firmId);
  const firms = actor.role === "super_admin" ? await listPlatformFirms(db, actor) : [];
  const [profile, list] = await Promise.all([getOrganizationProfile(db, scope.firmId), listAllAnnouncements(db, scope)]);

  const security: [string, string, boolean][] = [
    ["Role-based access", "Super Admin, Admin, Manager, Employee, Read Only and Client roles; permissions are enforced on the server", true],
    ["Session management", `Sessions expire after ${SESSION_IDLE_MS / 3_600_000} h idle and ${SESSION_ABSOLUTE_MS / 3_600_000} h maximum`, true],
    ["Account lockout", `${MAX_FAILED_LOGINS} failed sign-ins lock an account for ${LOCKOUT_MS / 60_000} minutes`, true],
    ["Password storage", "Minimum 12 characters, stored as argon2id hashes", true],
    ["Audit trail", "Sign-ins, record changes and document downloads are recorded", true],
    ["Data in transit and at rest", "TLS with certificate verification; database encrypted at rest; row-level security on every table", true],
    ["Multi-factor authentication", "Not built yet. Required before real client data is loaded.", false],
    ["Malware scanning", "Not connected. Uploaded files are marked “Not scanned”.", false],
    ["Backup and recovery", "Configure point-in-time recovery in Supabase and test a restore.", false],
  ];

  return (
    <>
      <PageHeader title="Organization settings" description="Manage private firm identity, client-portal announcements and security posture." />
      {actor.role === "super_admin" ? <FirmScopePicker action="/crm/settings" currentFirmId={scope.firmId} firms={firms} /> : null}
      <div className="mt-5 mb-5">
        <TabNav label="Settings sections" items={(Object.keys(TABS) as Tab[]).map((t) => {
          const query = new URLSearchParams();
          if (t !== "profile") query.set("tab", t);
          if (actor.role === "super_admin") query.set("firmId", scope.firmId);
          const href = query.size ? `/crm/settings?${query.toString()}` : "/crm/settings";
          return { href, label: TABS[t], active: tab === t };
        })} />
      </div>

      {tab === "profile" ? (
        <div className="grid gap-5 xl:grid-cols-[1fr_20rem]">
          <Panel title="Organization profile" description="These details are private to the firm and used in its authenticated workspace.">
            {!profile.fromDatabase ? (
              <div className="mb-4">
                <Alert tone="info">This organization is using its registered firm name and default regional settings. Save the profile to customize it.</Alert>
              </div>
            ) : null}
            <FirmProfileForm profile={profile} firmId={scope.firmId} />
          </Panel>
          <Panel title="Where this appears">
            <ul className="space-y-2 text-[13px] text-muted">
              <li>Organization identity in the staff workspace and client portal</li>
              <li>Announcements shown only to authenticated clients in this firm</li>
              <li>Organization name used for client subscription checkout branding</li>
            </ul>
            <p className="mt-4 border-t border-line pt-3 text-xs leading-5 text-muted">
              This profile controls the firm identity shown in its workspace and client portal. QuickBooks invoices are issued through the firm’s own company connection and are not changed by profile contact details.
            </p>
          </Panel>
        </div>
      ) : null}

      {tab === "website" ? (
        <div className="grid gap-5 xl:grid-cols-[1fr_22rem]">
          <Panel title="Client announcements" description="Published items are visible to authenticated clients in this firm’s portal only." flush>
            {list.length ? (
              <SimpleTable label="Announcements" headers={[{ label: "Announcement" }, { label: "Date" }, { label: "Status" }, { label: "", align: "right" }]}>
                {list.map((a) => (
                  <tr key={a.id}>
                    <td className={td}>
                      <div className="font-medium text-ink">{a.title}</div>
                      <div className="line-clamp-1 text-[12px] text-muted">{a.body}</div>
                    </td>
                    <td className={`${td} tabular whitespace-nowrap text-muted`}>{formatDate(a.publishedOn)}</td>
                    <td className={td}><Badge tone={a.isPublished ? "good" : "neutral"} dot>{a.isPublished ? "Published" : "Hidden"}</Badge></td>
                    <td className={`${td} text-right`}><AnnouncementToggle id={a.id} published={a.isPublished} firmId={scope.firmId} /></td>
                  </tr>
                ))}
              </SimpleTable>
            ) : (
              <p className="p-4 text-[13px] text-muted">No announcements yet. The website shows the default announcement until you publish one.</p>
            )}
          </Panel>
          <Panel title="New announcement">
            <NewAnnouncementForm today={firmToday()} firmId={scope.firmId} />
          </Panel>
        </div>
      ) : null}

      {tab === "security" ? (
        <Panel title="Security controls" description="Current state of the safeguards protecting taxpayer data" flush>
          <SimpleTable label="Security controls" headers={[{ label: "Control" }, { label: "Detail" }, { label: "Status", align: "right" }]}>
            {security.map(([name, detail, on]) => (
              <tr key={name}>
                <td className={`${td} font-medium text-ink`}>{name}</td>
                <td className={`${td} text-muted`}>{detail}</td>
                <td className={`${td} text-right`}><Badge tone={on ? "good" : "warn"} dot>{on ? "Enabled" : "Action needed"}</Badge></td>
              </tr>
            ))}
          </SimpleTable>
        </Panel>
      ) : null}
    </>
  );
}
