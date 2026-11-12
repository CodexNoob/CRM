import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { SimpleTable, td, tdHide } from "@/components/table";
import { Alert, Avatar, Badge, PageHeader, Panel, StatStrip } from "@/components/ui";
import { requireStaffActor } from "@/lib/auth/current";
import { ROLE_LABELS } from "@/lib/labels";
import { getWorkload } from "@/services/insights";
import { listTeam } from "@/services/team";
import { InviteStaffForm, MemberMenu, RoleSelect } from "./team-controls";

export const metadata: Metadata = { title: "Team Members" };
const dateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

export default async function TeamPage({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const actor = await requireStaffActor();
  // Hidden for non-admins; the service enforces this independently.
  if (actor.role !== "admin") notFound();
  const { welcome } = await searchParams;
  const db = getDb();
  const [team, workload] = await Promise.all([listTeam(db, actor), getWorkload(db, actor)]);
  const load = new Map(workload.map((w) => [w.userId, w]));
  const active = team.filter((m) => m.isActive && m.hasPassword).length;

  return (
    <>
      <PageHeader title="Team Members" description="Staff accounts, roles and access. Roles control what each person can see." />
      {welcome ? (
        <div className="mb-4">
          <Alert tone="success">Your admin account is ready. Invite the rest of your team.</Alert>
        </div>
      ) : null}
      <StatStrip
        className="mb-5"
        items={[
          { label: "Active members", value: active, tone: "success" },
          { label: "Pending invitations", value: team.filter((m) => m.isActive && !m.hasPassword).length },
          { label: "Admins", value: team.filter((m) => m.role === "admin" && m.isActive).length },
          { label: "Deactivated", value: team.filter((m) => !m.isActive).length },
        ]}
      />
      <div className="grid gap-5 xl:grid-cols-[1fr_20rem]">
        <Panel title="Members" flush>
          <SimpleTable
            label="Team members"
            headers={[{ label: "Member" }, { label: "Role" }, { label: "Status", hideBelow: "sm" }, { label: "Workload", hideBelow: "lg" }, { label: "Added", hideBelow: "md" }, { label: "", align: "right" }]}
          >
            {team.map((m) => {
              const self = m.id === actor.userId;
              const w = load.get(m.id);
              return (
                <tr key={m.id}>
                  <td className={td}>
                    <div className="flex items-center gap-2.5">
                      <Avatar name={m.name} />
                      <div className="min-w-0">
                        <div className="truncate font-medium text-ink">
                          {m.name}
                          {self ? <span className="ml-1.5 text-[12px] font-normal text-muted">(you)</span> : null}
                        </div>
                        <div className="truncate text-[12px] text-muted">{m.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className={td}>{self ? <span className="text-ink">{ROLE_LABELS[m.role]}</span> : <RoleSelect userId={m.id} name={m.name} role={m.role} />}</td>
                  <td className={`${td} ${tdHide.sm}`}>
                    <Badge tone={!m.isActive ? "neutral" : m.hasPassword ? "good" : "warn"} dot>{!m.isActive ? "Deactivated" : m.hasPassword ? "Active" : "Invited"}</Badge>
                  </td>
                  <td className={`${td} ${tdHide.lg} tabular text-muted`}>{w ? `${w.openEngagements} engagement${w.openEngagements === 1 ? "" : "s"} · ${w.openTasks} task${w.openTasks === 1 ? "" : "s"}` : "—"}</td>
                  <td className={`${td} ${tdHide.md} tabular text-muted`}>{dateFmt.format(m.createdAt)}</td>
                  <td className={`${td} text-right`}>{self ? null : <MemberMenu userId={m.id} name={m.name} isActive={m.isActive} />}</td>
                </tr>
              );
            })}
          </SimpleTable>
        </Panel>
        <div className="space-y-5">
          <div id="invite" className="scroll-mt-20">
            <Panel title="Invite a team member">
              <InviteStaffForm />
            </Panel>
          </div>
          <Panel title="Roles">
            <dl className="space-y-3 text-[13px]">
              {[
                ["admin", "All clients, plus team management, settings and the audit log."],
                ["manager", "All clients and engagements."],
                ["employee", "Only clients they created or own work for."],
              ].map(([r, d]) => (
                <div key={r}>
                  <dt className="font-medium text-ink">{ROLE_LABELS[r as keyof typeof ROLE_LABELS]}</dt>
                  <dd className="text-muted">{d}</dd>
                </div>
              ))}
            </dl>
          </Panel>
        </div>
      </div>
    </>
  );
}
