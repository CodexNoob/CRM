import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getDb } from "@/db";
import { staffMessageAction } from "@/app/actions/phase1";
import { MessageThread } from "@/components/message-thread";
import { Avatar, ButtonLink, PageHeader } from "@/components/ui";
import { requireStaffActor } from "@/lib/auth/current";
import { orNotFound } from "@/lib/page-helpers";
import { getClient } from "@/services/clients";
import { getThread, listConversations } from "@/services/messages";
import { Inbox } from "../inbox";

export const metadata: Metadata = { title: "Conversation" };
export const dynamic = "force-dynamic";

export default async function ConversationPage({ params }: { params: Promise<{ clientId: string }> }) {
  const actor = await requireStaffActor();
  const { clientId } = await params;
  const db = getDb();
  const client = await orNotFound(getClient(db, actor, clientId));
  // Read the thread first (marks client messages read), then the inbox reflects it.
  const thread = await getThread(db, actor, client.id);
  const convos = await listConversations(db, actor);

  return (
    <>
      <PageHeader title="Messages" description="Secure conversations with your clients." />
      <div className="grid overflow-hidden rounded-lg border border-line bg-surface lg:h-[calc(100dvh-11rem)] lg:grid-cols-[22rem_1fr]">
        <div className="hidden overflow-y-auto border-r border-line lg:block">
          <Inbox convos={convos} activeId={client.id} />
        </div>
        <section className="flex min-h-0 flex-col" aria-label={`Conversation with ${client.displayName}`}>
          <header className="flex items-center gap-3 border-b border-line px-4 py-2.5">
            <Link href="/staff/messages" className="inline-flex size-8 items-center justify-center rounded-md text-muted hover:bg-subtle lg:hidden" aria-label="Back to inbox">
              <ArrowLeft className="size-4" />
            </Link>
            <Avatar name={client.displayName} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold text-ink">{client.displayName}</p>
              <p className="truncate text-[12px] text-muted">{client.email ?? "Client portal conversation"}</p>
            </div>
            <ButtonLink href={`/staff/clients/${client.id}`} variant="secondary" size="sm">Client profile</ButtonLink>
          </header>
          <div className="min-h-0 flex-1 p-4">
            <MessageThread
              messages={thread.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() }))}
              action={staffMessageAction.bind(null, client.id)}
              emptyText="No messages yet. Your message will appear in the client’s portal."
              placeholder={`Message ${client.displayName}…`}
            />
          </div>
        </section>
      </div>
    </>
  );
}
