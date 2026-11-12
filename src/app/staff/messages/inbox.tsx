import Link from "next/link";
import { MessagesSquare } from "lucide-react";
import { Avatar, EmptyState, cx } from "@/components/ui";
import type { ConversationSummary } from "@/services/messages";

const fmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const timeFmt = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });

function when(d: Date) {
  return Date.now() - d.getTime() < 86_400_000 ? timeFmt.format(d) : fmt.format(d);
}

/** Conversation list used by both the inbox and the open conversation (two-pane layout). */
export function Inbox({ convos, activeId }: { convos: ConversationSummary[]; activeId?: string }) {
  if (!convos.length) {
    return <EmptyState icon={<MessagesSquare />} title="No conversations yet">Messages from client portals and your replies appear here. Start one from a client’s profile.</EmptyState>;
  }
  return (
    <ul className="divide-y divide-line">
      {convos.map((c) => (
        <li key={c.clientId}>
          <Link
            href={`/staff/messages/${c.clientId}`}
            aria-current={activeId === c.clientId ? "page" : undefined}
            className={cx("flex items-start gap-3 px-3 py-3 hover:bg-hover", activeId === c.clientId && "bg-brand-soft/50 hover:bg-brand-soft/50")}
          >
            <Avatar name={c.clientName} />
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-2">
                <span className={cx("truncate text-[13px]", c.unread ? "font-semibold text-ink" : "font-medium text-ink")}>{c.clientName}</span>
                <span className="tabular shrink-0 text-[11.5px] text-faint">{when(c.lastAt)}</span>
              </span>
              <span className="flex items-center gap-2">
                <span className={cx("min-w-0 flex-1 truncate text-[12.5px]", c.unread ? "text-ink" : "text-muted")}>
                  {c.lastFromClient ? "" : "You: "}
                  {c.lastBody}
                </span>
                {c.unread ? (
                  <span className="tabular rounded bg-brand px-1.5 text-[11px] font-medium leading-4.5 text-white">
                    {c.unread}
                    <span className="sr-only"> unread</span>
                  </span>
                ) : null}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
