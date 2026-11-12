import { cookies } from "next/headers";
import { getDb } from "@/db";
import { navForRole } from "@/components/staff/nav-config";
import { StaffShell } from "@/components/staff/shell";
import { requireStaffActor } from "@/lib/auth/current";
import { ROLE_LABELS } from "@/lib/labels";
import { countLeadsByStatus } from "@/services/leads";
import { countUnreadForStaff } from "@/services/messages";
import { getPublicProfile } from "@/services/settings";
import { countMyOpenTasks } from "@/services/tasks";
import { getNotifications } from "@/services/workspace";

function initials(name: string) {
  const words = name.split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words[0]![0]! + words[1]![0]! : name.slice(0, 2)).toUpperCase();
}

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireStaffActor();
  const db = getDb();
  // Admin-only items are hidden here AND refused by their pages and services on the server.
  const sections = navForRole(actor.role === "admin");
  const [myOpenTasks, leadCounts, unreadMessages, notifications, profile, jar] = await Promise.all([
    countMyOpenTasks(db, actor),
    countLeadsByStatus(db, actor),
    countUnreadForStaff(db, actor),
    getNotifications(db, actor),
    getPublicProfile(db),
    cookies(),
  ]);

  return (
    <StaffShell
      sections={sections}
      badges={{ myOpenTasks, newLeads: leadCounts.new, unreadMessages }}
      initialCollapsed={jar.get("crm_sidebar")?.value === "collapsed"}
      workspace={{ name: profile.name, initials: initials(profile.name) }}
      user={{ name: actor.name, email: actor.email, roleLabel: ROLE_LABELS[actor.role], isAdmin: actor.role === "admin" }}
      notifications={notifications}
    >
      {children}
    </StaffShell>
  );
}
