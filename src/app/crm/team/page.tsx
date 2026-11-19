import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { SimpleTable, td, tdHide } from "@/components/table";
import { Alert, Avatar, Badge, PageHeader, Panel, StatStrip } from "@/components/ui";
import { requireStaffActor } from "@/lib/auth/current";
import { canManageTeam } from "@/lib/auth/actor";
import { FirmScopePicker } from "@/components/staff/firm-scope-picker";
import { ROLE_LABELS } from "@/lib/labels";
import { getWorkload } from "@/services/insights";
import { listTeam } from "@/services/team";
import { getFirm, listPlatformFirms, resolveFirmContext } from "@/services/firms";
import { InviteStaffButton, MemberMenu, RoleSelect } from "./team-controls";

export const metadata: Metadata = { title: "Team Members" };
const dateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

export default async function TeamPage({ searchParams }: { searchParams: Promise<{ welcome?: string; firmId?: string }> }) {
  const actor = await requireStaffActor();
  // Hidden for non-admins; the service enforces this independently.
  if (!canManageTeam(actor)) notFound();
  const params = await searchParams;
  const db = getDb();
  const scope = await resolveFirmContext(db, actor, params.firmId);
  const firms = actor.role === "super_admin" ? await listPlatformFirms(db, actor) : [];
  const [team, workload, firm] = await Promise.all([listTeam(db, scope), getWorkload(db, scope), getFirm(db, scope.firmId)]);
  const load = new Map(workload.map((w) => [w.userId, w]));
  const active = team.filter((m) => m.isActive && m.hasPassword).length;

  return (
    <>
      <PageHeader
        title="Team Members"
        description="Staff accounts, roles and access. Each role has a distinct permission set."
        actions={<InviteStaffButton firmId={scope.firmId} canManageSuperAdmins={actor.role === "super_admin"} />}
      />
      {actor.role === "super_admin" ? <FirmScopePicker action="/crm/team" currentFirmId={scope.firmId} firms={firms} /> : null}
      {params.welcome ? (
        <div className="mb-4">
          <Alert tone="success">Your admin account is ready. Invite the rest of your team.</Alert>
        </div>
      ) : null}
      <StatStrip
        className="mb-5"
        items={[
          { label: "Active members", value: active, tone: "success" },
          { label: "Pending invitations", value: team.filter((m) => m.isActive && !m.hasPassword).length },
          { label: "Owners", value: team.filter((m) => m.role === "admin" && m.isActive).length },
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
                  <td className={td}>{self || m.role === "admin" ? <span className="text-ink">{ROLE_LABELS[m.role]}</span> : <RoleSelect userId={m.id} name={m.name} role={m.role} firmId={scope.firmId} canManageSuperAdmins={actor.role === "super_admin"} disabled={m.role === "super_admin" && actor.role !== "super_admin"} />}</td>
                  <td className={`${td} ${tdHide.sm}`}>
                    <Badge tone={!m.isActive ? "neutral" : m.hasPassword ? "good" : "warn"} dot>{!m.isActive ? "Deactivated" : m.hasPassword ? "Active" : "Invited"}</Badge>
                  </td>
                  <td className={`${td} ${tdHide.lg} tabular text-muted`}>{w ? `${w.openEngagements} engagement${w.openEngagements === 1 ? "" : "s"} · ${w.openTasks} task${w.openTasks === 1 ? "" : "s"}` : "—"}</td>
                  <td className={`${td} ${tdHide.md} tabular text-muted`}>{dateFmt.format(m.createdAt)}</td>
                  <td className={`${td} text-right`}>{self ? null : <MemberMenu userId={m.id} name={m.name} isActive={m.isActive} firmId={scope.firmId} />}</td>
                </tr>
              );
            })}
          </SimpleTable>
        </Panel>
        <div className="space-y-5">
          <Panel title="Roles">
            <dl className="space-y-3 text-[13px]">
              {[
                ["admin", "Firm Owner. Created the firm and controls ownership, subscription and full access."],
                ["administrator", "Manages staff and daily firm operations; Owner retains subscription and security ownership."],
                ["operations_manager", "Oversees delivery, workload, approvals and client records across the firm."],
                ["project_manager", "Plans client engagements and assigned delivery work."],
                ["team_member", "Works on assigned clients, tasks and engagements."],
                ["sales_manager", "Manages firm leads, sales assignments and pipeline reports."],
                ["sales_representative", "Works assigned prospects and sales follow-ups."],
                ["finance_manager", "Manages billing, bookkeeping and financial approvals."],
                ["accountant", "Prepares assigned financial and tax work."],
                ["marketing_manager", "Manages leads and firm level marketing reports."],
                ["account_manager", "Supports assigned client relationships and portal contacts."],
                ["support_agent", "Helps clients with messages, documents and portal access."],
                ["developer", "No client or firm data access by default."],
                ["read_only", "View firm records without changing them."],
                ...(actor.role === "super_admin" ? [["super_admin", `Platform-wide access; currently scoped to ${firm.name}.`] as [string, string]] : []),
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
