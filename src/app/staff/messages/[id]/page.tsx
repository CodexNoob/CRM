import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getDb } from "@/db";
import { staffReplyAction } from "@/app/actions/messages";
import { MessageThread } from "@/components/message-thread";
import { Avatar, Badge, ButtonLink } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { requireStaffActor } from "@/lib/auth/current";
import { NotFoundError } from "@/lib/errors";
import { listClientOptions } from "@/services/clients";
import { listStaff } from "@/services/engagements";
import { countInboxFolders, getConversation, isConversationId, latestConversationForClient, listAssignmentHistory, listInbox } from "@/services/messages";
import { conversationNumber, CONVERSATION_CATEGORY_LABELS, CONVERSATION_STATUS_LABELS, CONVERSATION_STATUS_TONE } from "../conversation-labels";
import { Inbox } from "../inbox";
import { InboxShell, parseInbox, type InboxSearch } from "../inbox-shell";
import { ConversationControls } from "../message-controls";

export const metadata: Metadata = { title: "Conversation" };
export const dynamic = "force-dynamic";

const when = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default async function ConversationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<InboxSearch> }) {
  const actor = await requireStaffActor();
  const { id } = await params;
  const db = getDb();

  // Old links were /staff/messages/<clientId>: send them to that client's latest conversation.
  if (!(await isConversationId(db, actor, id))) {
    let latest: string | null;
    try {
      latest = await latestConversationForClient(db, actor, id);
    } catch (error) {
      if (error instanceof NotFoundError) notFound();
      throw error;
    }
    redirect(latest ? `/staff/messages/${latest}` : `/staff/messages?client=${id}`);
  }

  let detail: Awaited<ReturnType<typeof getConversation>>;
  try {
    // Opening the conversation marks it read for this staff member (before counts are taken).
    detail = await getConversation(db, actor, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const { folder, params: qp, filters } = parseInbox(await searchParams);
  const [convos, counts, clients, staff, history] = await Promise.all([listInbox(db, actor, filters), countInboxFolders(db, actor), listClientOptions(db, actor), listStaff(db, actor), listAssignmentHistory(db, actor, id)]);
  const c = detail.conversation;
  const staffOptions = staff.map((s) => ({ id: s.id, name: s.name }));
  const canReply = can(actor, "messages", "reply");

  return (
    <InboxShell counts={counts} folder={folder} params={qp} clients={clients} staff={staffOptions} list={<Inbox convos={convos} activeId={c.id} />} hideListOnMobile>
      <section className="flex min-h-[70dvh] flex-col lg:min-h-0" aria-label={`Conversation: ${c.subject}`}>
        <header className="space-y-2 border-b border-line px-4 py-2.5">
          <div className="flex items-center gap-3">
            <Link href="/staff/messages" className="inline-flex size-8 items-center justify-center rounded-md text-muted hover:bg-subtle lg:hidden" aria-label="Back to inbox">
              <ArrowLeft className="size-4" />
            </Link>
            <Avatar name={detail.clientName} />
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-[13px] font-semibold text-ink">
                <span className="truncate">{c.subject}</span>
                <Badge tone={CONVERSATION_STATUS_TONE[c.status]} dot>{CONVERSATION_STATUS_LABELS[c.status]}</Badge>
              </p>
              <p className="truncate text-[12px] text-muted">
                {conversationNumber(c.conversationNumber) ? `${conversationNumber(c.conversationNumber)} · ` : ""}
                <Link href={`/staff/clients/${c.clientId}`} className="hover:text-ink hover:underline">{detail.clientName}</Link>
                {" · "}
                {CONVERSATION_CATEGORY_LABELS[c.category]}
                {detail.engagementTitle && c.engagementId ? (
                  <>
                    {" · "}
                    <Link href={`/staff/engagements/${c.engagementId}`} className="hover:text-ink hover:underline">{detail.engagementTitle}</Link>
                  </>
                ) : null}
              </p>
            </div>
            <ButtonLink href={`/staff/clients/${c.clientId}?tab=messages`} variant="secondary" size="sm">Client</ButtonLink>
          </div>
          <ConversationControls
            conversationId={c.id}
            status={c.status}
            category={c.category}
            priority={c.priority}
            assignee={c.assignedStaffId ? { id: c.assignedStaffId, name: detail.assigneeName ?? "Staff" } : null}
            staff={staffOptions}
            can={{ close: can(actor, "messages", "close"), assign: can(actor, "messages", "assign"), edit: canReply }}
          />
          {history.length ? (
            <details className="text-[12px] text-muted">
              <summary className="cursor-pointer select-none hover:text-ink">Assignment history ({history.length})</summary>
              <ul className="mt-1 space-y-0.5">
                {history.map((h, i) => (
                  <li key={i}>
                    {when.format(h.at)} — {h.actorName ?? "Someone"} {h.toName ? `assigned ${h.toName}` : "unassigned the conversation"}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </header>
        <div className="min-h-0 flex-1 p-4">
          <MessageThread
            messages={detail.messages.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() }))}
            action={staffReplyAction.bind(null, c.id)}
            emptyText="No messages yet."
            placeholder={`Message ${detail.clientName}…`}
            allowInternal={can(actor, "messages", "internal_note")}
            allowAttachments={can(actor, "documents", "upload")}
            disabledReason={canReply ? undefined : "Your account is read-only."}
          />
        </div>
      </section>
    </InboxShell>
  );
}
