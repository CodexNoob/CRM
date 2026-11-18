import Link from "next/link";
import { MessagesSquare } from "lucide-react";
import { Badge, EmptyState, Panel } from "@/components/ui";
import type { ActionState } from "@/lib/action-state";
import type { InboxRow } from "@/services/messages";
import { conversationNumber, CONVERSATION_CATEGORY_LABELS, CONVERSATION_STATUS_LABELS, CONVERSATION_STATUS_TONE } from "./conversation-labels";
import { NewConversationButton } from "./message-controls";
import { QuickMessage } from "./quick-message";

const when = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** The client page's Messages tab: this client's conversations, a new-conversation button, and a quick message. */
export function ClientConversations({
  clientId,
  clientName,
  convos,
  staff,
  canCreate,
  canAssign,
  quickAction,
}: {
  clientId: string;
  clientName: string;
  convos: InboxRow[];
  staff: { id: string; name: string }[];
  canCreate: boolean;
  canAssign: boolean;
  /** Posts into the client's General conversation. */
  quickAction: ((prev: ActionState, formData: FormData) => Promise<ActionState>) | null;
}) {
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <Panel
        title={`Conversations with ${clientName}`}
        flush
        actions={canCreate ? <NewConversationButton clients={[]} staff={staff} clientId={clientId} canAssign={canAssign} label="New" /> : null}
      >
        {convos.length ? (
          <ul className="divide-y divide-line">
            {convos.map((c) => (
              <li key={c.id}>
                <Link href={`/crm/messages/${c.id}`} className="flex items-start justify-between gap-3 px-4 py-3 hover:bg-hover">
                  <span className="min-w-0">
                    <span className="flex items-center gap-2 text-[13px] font-medium text-ink">
                      {c.unread ? <span className="size-2 shrink-0 rounded-full bg-brand" aria-label="Unread" /> : null}
                      <span className="truncate">{c.subject}</span>
                    </span>
                    <span className="block truncate text-[12px] text-muted">
                      {conversationNumber(c.conversationNumber) ? `${conversationNumber(c.conversationNumber)} · ` : ""}
                      {CONVERSATION_CATEGORY_LABELS[c.category]} · {c.assigneeName ?? "Unassigned"}
                      {c.lastBody ? ` · ${c.lastFromClient ? "" : "You: "}${c.lastBody}` : ""}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <Badge tone={CONVERSATION_STATUS_TONE[c.status]}>{CONVERSATION_STATUS_LABELS[c.status]}</Badge>
                    <span className="text-[11.5px] text-faint tabular">{when.format(c.lastMessageAt)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon={<MessagesSquare />} title="No conversations yet">Start a conversation — it appears in the client’s portal.</EmptyState>
        )}
      </Panel>
      {quickAction ? (
        <Panel title="Quick message" description="Adds to the client’s General conversation.">
          <QuickMessage action={quickAction} />
        </Panel>
      ) : null}
    </div>
  );
}
