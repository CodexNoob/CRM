import type { ReactNode } from "react";
import { inputClass } from "@/components/form";
import { buttonClass } from "@/components/ui";
import type { ConversationCategory, ConversationStatus } from "@/db/schema";
import { CONVERSATION_CATEGORIES, CONVERSATION_STATUSES, type InboxFilters as Filters, type InboxFolder } from "@/services/messages";
import { CONVERSATION_CATEGORY_LABELS, CONVERSATION_STATUS_LABELS, INBOX_FOLDERS } from "./conversation-labels";
import { InboxFolders, inboxHref } from "./inbox";

export type InboxSearch = { folder?: string; q?: string; client?: string; status?: string; category?: string; assignee?: string };

/** Parses ?folder=&q=&client=&status=&category=&assignee= (unknown values ignored). */
export function parseInbox(sp: InboxSearch): { folder: InboxFolder; params: Record<string, string | undefined>; filters: Filters } {
  const folder = (INBOX_FOLDERS.some((f) => f.key === sp.folder) ? sp.folder : "inbox") as InboxFolder;
  const status = CONVERSATION_STATUSES.includes(sp.status as ConversationStatus) ? (sp.status as ConversationStatus) : undefined;
  const category = CONVERSATION_CATEGORIES.includes(sp.category as ConversationCategory) ? (sp.category as ConversationCategory) : undefined;
  const params = { folder: folder === "inbox" ? undefined : folder, q: sp.q?.slice(0, 100) || undefined, client: sp.client || undefined, status, category, assignee: sp.assignee || undefined };
  return { folder, params, filters: { folder, q: params.q, clientId: params.client, status, category, assigneeId: params.assignee } };
}

/** Three-pane layout: folders, filters + list, and the open conversation (children). */
export function InboxShell({
  counts,
  folder,
  params,
  clients,
  staff,
  list,
  hideListOnMobile,
  children,
}: {
  counts: Record<string, number>;
  folder: InboxFolder;
  params: Record<string, string | undefined>;
  clients: { id: string; name: string }[];
  staff: { id: string; name: string }[];
  list: ReactNode;
  /** On small screens show only the open conversation. */
  hideListOnMobile?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="grid overflow-hidden rounded-lg border border-line bg-surface lg:h-[calc(100dvh-11rem)] lg:grid-cols-[11.5rem_21rem_1fr]">
      <div className={`${hideListOnMobile ? "hidden lg:block" : ""} border-b border-line lg:border-b-0 lg:border-r`}>
        <InboxFolders counts={counts} active={folder} params={params} />
      </div>
      <div className={`${hideListOnMobile ? "hidden lg:flex" : "flex"} min-h-0 flex-col border-line lg:border-r`}>
        <InboxFilterForm params={params} clients={clients} staff={staff} />
        <div className="min-h-0 flex-1 overflow-y-auto">{list}</div>
      </div>
      {children}
    </div>
  );
}

function InboxFilterForm({ params, clients, staff }: { params: Record<string, string | undefined>; clients: { id: string; name: string }[]; staff: { id: string; name: string }[] }) {
  const anyFilter = !!(params.client || params.status || params.category || params.assignee);
  return (
    <form method="get" action="/staff/messages" className="space-y-2 border-b border-line p-2" role="search">
      {params.folder ? <input type="hidden" name="folder" value={params.folder} /> : null}
      <label htmlFor="inbox-q" className="sr-only">Search conversations</label>
      <input id="inbox-q" name="q" type="search" defaultValue={params.q} placeholder="Search subject, client, message…" className={inputClass} />
      <details className="text-[12.5px]" open={anyFilter}>
        <summary className="cursor-pointer select-none text-muted hover:text-ink">Filters{anyFilter ? " (active)" : ""}</summary>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <select name="client" defaultValue={params.client ?? ""} aria-label="Client" className={inputClass}>
            <option value="">All clients</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <select name="status" defaultValue={params.status ?? ""} aria-label="Status" className={inputClass}>
            <option value="">Any status</option>
            {Object.entries(CONVERSATION_STATUS_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
          <select name="category" defaultValue={params.category ?? ""} aria-label="Category" className={inputClass}>
            <option value="">Any category</option>
            {Object.entries(CONVERSATION_CATEGORY_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
          <select name="assignee" defaultValue={params.assignee ?? ""} aria-label="Assigned staff" className={inputClass}>
            <option value="">Anyone</option>
            <option value="none">Unassigned</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
      </details>
      <div className="flex gap-2">
        <button type="submit" className={buttonClass("secondary", "flex-1", "sm")}>Apply</button>
        <a href={inboxHref({ folder: params.folder })} className={buttonClass("ghost", undefined, "sm")}>Clear</a>
      </div>
    </form>
  );
}
