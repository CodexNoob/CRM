import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getDb } from "@/db";
import { portalReplyAction } from "@/app/actions/messages";
import { MessageThread } from "@/components/message-thread";
import { Badge, Card, PageHeader } from "@/components/ui";
import { requirePortalContext } from "@/lib/auth/portal-context";
import { NotFoundError } from "@/lib/errors";
import { getPortalConversation } from "@/services/messages";
import { CONVERSATION_CATEGORY_LABELS, CONVERSATION_STATUS_TONE, PORTAL_CONVERSATION_STATUS } from "@/app/staff/messages/conversation-labels";

export const metadata: Metadata = { title: "Conversation" };
export const dynamic = "force-dynamic";

export default async function PortalConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { actor, client } = await requirePortalContext();
  const { id } = await params;
  let detail: Awaited<ReturnType<typeof getPortalConversation>>;
  try {
    // Only conversations of the server-resolved client; internal notes are excluded in SQL.
    detail = await getPortalConversation(getDb(), actor, client.clientId, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const c = detail.conversation;
  const closed = c.status === "closed";

  return (
    <>
      <Link href="/portal/messages" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> All conversations
      </Link>
      <PageHeader title={c.subject} description={CONVERSATION_CATEGORY_LABELS[c.category]} actions={<Badge tone={CONVERSATION_STATUS_TONE[c.status]} dot>{PORTAL_CONVERSATION_STATUS[c.status]}</Badge>} />
      <Card>
        <MessageThread
          messages={detail.messages.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() }))}
          action={portalReplyAction.bind(null, c.id)}
          emptyText="No messages yet."
          allowAttachments
          disabledReason={closed ? "This conversation is closed. Start a new message if you need anything else." : undefined}
        />
      </Card>
      {closed ? (
        <p className="mt-3 text-sm">
          <Link href="/portal/messages?new=1" className="font-medium text-brand-ink hover:underline">Start a new conversation</Link>
        </p>
      ) : null}
    </>
  );
}
