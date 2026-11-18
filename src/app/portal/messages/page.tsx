import type { Metadata } from "next";
import Link from "next/link";
import { MessagesSquare } from "lucide-react";
import { getDb } from "@/db";
import { Badge, Card, EmptyState, PageHeader, cx } from "@/components/ui";
import { requirePortalContext } from "@/lib/auth/portal-context";
import { listPortalConversations } from "@/services/messages";
import { CONVERSATION_CATEGORY_LABELS, CONVERSATION_STATUS_TONE, PORTAL_CONVERSATION_STATUS } from "@/app/crm/messages/conversation-labels";
import { PortalNewConversation } from "./portal-message-forms";

export const metadata: Metadata = { title: "Messages" };
export const dynamic = "force-dynamic";

const when = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default async function PortalMessagesPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  // The client is resolved on the server; nothing from the URL selects whose messages are shown.
  const { actor, client } = await requirePortalContext();
  const convos = await listPortalConversations(getDb(), actor, client.clientId);
  const startNew = (await searchParams).new === "1" || convos.length === 0;

  return (
    <>
      <PageHeader title="Messages" description="Private conversations with your firm." />
      <div className="space-y-5">
        <PortalNewConversation startOpen={startNew} />
        <Card title="Your conversations">
          {convos.length ? (
            <ul className="divide-y divide-line">
              {convos.map((c) => (
                <li key={c.id}>
                  <Link href={`/portal/messages/${c.id}`} className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0 hover:bg-hover">
                    <span className="min-w-0">
                      <span className={cx("flex items-center gap-2 text-[14px]", c.unread ? "font-semibold text-ink" : "font-medium text-ink")}>
                        {c.unread ? <span className="size-2 shrink-0 rounded-full bg-brand" aria-label="Unread" /> : null}
                        <span className="truncate">{c.subject}</span>
                      </span>
                      <span className="block truncate text-[13px] text-muted">
                        {c.lastBody ? `${c.lastFromClient ? "You: " : ""}${c.lastBody}` : CONVERSATION_CATEGORY_LABELS[c.category]}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <Badge tone={CONVERSATION_STATUS_TONE[c.status]}>{PORTAL_CONVERSATION_STATUS[c.status]}</Badge>
                      <span className="text-[12px] text-faint tabular">{when.format(c.lastMessageAt)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={<MessagesSquare />} title="No conversations yet">Send the firm a message above — we usually reply within one business day.</EmptyState>
          )}
        </Card>
      </div>
    </>
  );
}
