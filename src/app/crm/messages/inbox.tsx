import Link from "next/link";
import { MessagesSquare, StickyNote } from "lucide-react";
import { Avatar, Badge, EmptyState, cx } from "@/components/ui";
import type { InboxFolder, InboxRow } from "@/services/messages";
import { CONVERSATION_CATEGORY_LABELS, CONVERSATION_STATUS_LABELS, CONVERSATION_STATUS_TONE, INBOX_FOLDERS } from "./conversation-labels";

const fmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const timeFmt = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });

function when(d: Date) {
  return Date.now() - d.getTime() < 86_400_000 ? timeFmt.format(d) : fmt.format(d);
}

/** Builds an inbox URL keeping the current filters. */
export function inboxHref(params: Record<string, string | undefined>, over: Record<string, string | undefined> = {}) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...params, ...over })) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `/crm/messages?${s}` : "/crm/messages";
}

/** Folder sidebar with counts. */
export function InboxFolders({ counts, active, params }: { counts: Record<string, number>; active: InboxFolder; params: Record<string, string | undefined> }) {
  return (
    <nav aria-label="Message folders" className="flex gap-1 overflow-x-auto p-2 lg:flex-col lg:overflow-visible">
      {INBOX_FOLDERS.map((f) => (
        <Link
          key={f.key}
          href={inboxHref(params, { folder: f.key === "inbox" ? undefined : f.key })}
          aria-current={active === f.key ? "page" : undefined}
          className={cx(
            "flex shrink-0 items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-[13px]",
            active === f.key ? "bg-brand-soft font-medium text-brand-ink" : "text-muted hover:bg-subtle hover:text-ink",
          )}
        >
          <span>{f.label}</span>
          <span className="tabular text-[11.5px]">{counts[f.key] ?? 0}</span>
        </Link>
      ))}
    </nav>
  );
}

/** Conversation list used by the inbox and the open conversation (two-pane layout). */
export function Inbox({ convos, activeId, emptyText }: { convos: InboxRow[]; activeId?: string; emptyText?: string }) {
  if (!convos.length) {
    return (
      <EmptyState icon={<MessagesSquare />} title="No conversations here">
        {emptyText ?? "Client messages and your conversations appear here. Start one with “New conversation”."}
      </EmptyState>
    );
  }
  return (
    <ul className="divide-y divide-line">
      {convos.map((c) => (
        <li key={c.id}>
          <Link
            href={`/crm/messages/${c.id}`}
            aria-current={activeId === c.id ? "page" : undefined}
            className={cx("flex items-start gap-3 px-3 py-3 hover:bg-hover", activeId === c.id && "bg-brand-soft/50 hover:bg-brand-soft/50")}
          >
            <Avatar name={c.clientName} />
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-2">
                <span className={cx("flex min-w-0 items-center gap-1.5 truncate text-[13px]", c.unread ? "font-semibold text-ink" : "font-medium text-ink")}>
                  {c.unread ? <span className="size-2 shrink-0 rounded-full bg-brand" aria-label="Unread" /> : null}
                  <span className="truncate">{c.subject}</span>
                </span>
                <span className="tabular shrink-0 text-[11.5px] text-faint">{when(c.lastMessageAt)}</span>
              </span>
              <span className="block truncate text-[12px] text-muted">
                {c.clientName} · {CONVERSATION_CATEGORY_LABELS[c.category]}
                {c.assigneeName ? ` · ${c.assigneeName}` : " · Unassigned"}
              </span>
              <span className="mt-0.5 flex items-center gap-2">
                <span className={cx("min-w-0 flex-1 truncate text-[12.5px]", c.unread ? "text-ink" : "text-muted")}>
                  {c.lastBody ? `${c.lastFromClient ? "" : "You: "}${c.lastBody}` : <span className="inline-flex items-center gap-1"><StickyNote className="size-3" aria-hidden /> Internal notes only</span>}
                </span>
                <Badge tone={CONVERSATION_STATUS_TONE[c.status]}>{CONVERSATION_STATUS_LABELS[c.status]}</Badge>
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
