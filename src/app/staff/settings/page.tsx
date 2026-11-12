import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { SimpleTable, td } from "@/components/table";
import { Alert, Badge, PageHeader, Panel, TabNav } from "@/components/ui";
import { requireStaffActor } from "@/lib/auth/current";
import { MAX_FAILED_LOGINS, LOCKOUT_MS } from "@/lib/auth/login";
import { SESSION_ABSOLUTE_MS, SESSION_IDLE_MS } from "@/lib/auth/sessions";
import { formatDate } from "@/lib/labels";
import { firmToday } from "@/services/dashboard";
import { getPublicProfile, listAllAnnouncements } from "@/services/settings";
import { AnnouncementToggle, FirmProfileForm, NewAnnouncementForm } from "./settings-forms";

export const metadata: Metadata = { title: "Settings" };

const TABS = { profile: "Firm profile", website: "Website announcements", security: "Security" } as const;
type Tab = keyof typeof TABS;

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const actor = await requireStaffActor();
  if (actor.role !== "admin") notFound();
  const requested = (await searchParams).tab;
  const tab: Tab = requested && requested in TABS ? (requested as Tab) : "profile";
  const db = getDb();
  const [profile, list] = await Promise.all([getPublicProfile(db, actor.firmId), listAllAnnouncements(db, actor)]);

  const security: [string, string, boolean][] = [
    ["Role-based access", "Admin, partner, preparer and client roles, enforced on the server for every record", true],
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
      <PageHeader title="Settings" description="Firm profile, public website content and security posture." />
      <div className="mb-5">
        <TabNav label="Settings sections" items={(Object.keys(TABS) as Tab[]).map((t) => ({ href: t === "profile" ? "/staff/settings" : `/staff/settings?tab=${t}`, label: TABS[t], active: tab === t }))} />
      </div>

      {tab === "profile" ? (
        <div className="grid gap-5 xl:grid-cols-[1fr_20rem]">
          <Panel title="Firm profile" description="Shown on the public website and in the workspace">
            {!profile.fromDatabase ? (
              <div className="mb-4">
                <Alert tone="info">The website is showing default placeholder details. Save this form to replace them.</Alert>
              </div>
            ) : null}
            <FirmProfileForm profile={profile} />
          </Panel>
          <Panel title="Where this appears">
            <ul className="space-y-2 text-[13px] text-muted">
              <li>Website header, contact section and footer</li>
              <li>Search engine listing (name, phone, address)</li>
              <li>Workspace switcher in the sidebar</li>
            </ul>
          </Panel>
        </div>
      ) : null}

      {tab === "website" ? (
        <div className="grid gap-5 xl:grid-cols-[1fr_22rem]">
          <Panel title="Announcements" description="Published items appear on the website’s home page" flush>
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
                    <td className={`${td} text-right`}><AnnouncementToggle id={a.id} published={a.isPublished} /></td>
                  </tr>
                ))}
              </SimpleTable>
            ) : (
              <p className="p-4 text-[13px] text-muted">No announcements yet. The website shows the default announcement until you publish one.</p>
            )}
          </Panel>
          <Panel title="New announcement">
            <NewAnnouncementForm today={firmToday()} />
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
