import type { Metadata } from "next";
import { MessagesSquare } from "lucide-react";
import { getDb } from "@/db";
import { EmptyState, PageHeader } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { requireStaffActor } from "@/lib/auth/current";
import { listClientOptions } from "@/services/clients";
import { listStaff } from "@/services/engagements";
import { countInboxFolders, listInbox } from "@/services/messages";
import { Inbox } from "./inbox";
import { InboxShell, parseInbox, type InboxSearch } from "./inbox-shell";
import { NewConversationButton } from "./message-controls";

export const metadata: Metadata = { title: "Messages" };
export const dynamic = "force-dynamic";

export default async function MessagesPage({ searchParams }: { searchParams: Promise<InboxSearch> }) {
  const actor = await requireStaffActor();
  const db = getDb();
  const { folder, params, filters } = parseInbox(await searchParams);
  const [convos, counts, clients, staff] = await Promise.all([listInbox(db, actor, filters), countInboxFolders(db, actor), listClientOptions(db, actor), listStaff(db, actor)]);
  const staffOptions = staff.map((s) => ({ id: s.id, name: s.name }));

  return (
    <>
      <PageHeader
        title="Messages"
        description={counts.unread ? `${counts.unread} unread message${counts.unread === 1 ? "" : "s"} from clients.` : "Secure conversations with your clients."}
        actions={can(actor, "messages", "create") ? <NewConversationButton clients={clients} staff={staffOptions} canAssign={can(actor, "messages", "assign")} /> : undefined}
      />
      <InboxShell counts={counts} folder={folder} params={params} clients={clients} staff={staffOptions} list={<Inbox convos={convos} />}>
        <div className="hidden items-center justify-center lg:flex">
          <EmptyState icon={<MessagesSquare />} title="Select a conversation">Choose a conversation to read and reply.</EmptyState>
        </div>
      </InboxShell>
    </>
  );
}
