import Link from "next/link";
import { ArrowRight, CalendarClock, FileText, Handshake, Mail, MessageSquare, Phone, StickyNote, UserPlus, Workflow } from "lucide-react";
import type { ReactNode } from "react";
import { EmptyState } from "@/components/ui";
import {
  ACTIVITY_TYPE_LABELS,
  CLIENT_STATUS_LABELS,
  LEAD_STATUS_LABELS,
  ONBOARDING_STATUS_LABELS,
  STATUS_LABELS,
  TASK_STATUS_LABELS,
} from "@/lib/labels";
import type { TimelineItem } from "@/services/timeline";

const timeFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: process.env.FIRM_TIMEZONE || "America/New_York",
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const ICONS: Record<TimelineItem["type"], ReactNode> = {
  note: <StickyNote />,
  call: <Phone />,
  email: <Mail />,
  meeting: <Handshake />,
  comment: <MessageSquare />,
  internal_note: <StickyNote />,
  assignment: <UserPlus />,
  status_change: <Workflow />,
  system: <FileText />,
};

const ENTITY_LABEL: Record<string, string> = { lead: "Lead", client: "Client", engagement: "Engagement", task: "Task" };

/** Human label for a status value, whichever record type it belongs to. */
function statusLabel(entityType: string, field: unknown, value: unknown): string {
  if (typeof value !== "string") return "—";
  const maps: Record<string, Record<string, string>> = {
    lead: LEAD_STATUS_LABELS,
    client: CLIENT_STATUS_LABELS,
    engagement: STATUS_LABELS,
    task: TASK_STATUS_LABELS,
  };
  const map = field === "onboarding" ? ONBOARDING_STATUS_LABELS : maps[entityType];
  return (map as Record<string, string> | undefined)?.[value] ?? value.replace(/_/g, " ");
}

function entityHref(item: TimelineItem): string | null {
  if (item.entityType === "engagement") return `/crm/engagements/${item.entityId}`;
  if (item.entityType === "lead") return `/crm/leads/${item.entityId}`;
  return null;
}

/**
 * The client's business timeline (client, its lead, engagements and tasks), newest first.
 * `staffNames` resolves user ids in assignment entries.
 */
export function ClientTimeline({ items, staffNames, emptyText = "No activity yet." }: { items: TimelineItem[]; staffNames: Record<string, string>; emptyText?: string }) {
  if (!items.length) return <EmptyState icon={<CalendarClock />} title={emptyText} />;
  return (
    <ol className="divide-y divide-line">
      {items.map((a) => {
        const meta = a.metadata ?? {};
        const href = entityHref(a);
        let summary: ReactNode;
        if (a.type === "status_change") {
          const field = meta.field;
          summary = (
            <span className="inline-flex flex-wrap items-center gap-1">
              {field === "onboarding" ? "Onboarding" : `${ENTITY_LABEL[a.entityType] ?? "Record"} status`}
              {meta.from ? (
                <>
                  <span className="text-muted">{statusLabel(a.entityType, field, meta.from)}</span>
                  <ArrowRight className="size-3 text-faint" aria-label="to" />
                </>
              ) : null}
              <span className="font-medium">{statusLabel(a.entityType, field, meta.to)}</span>
            </span>
          );
        } else if (a.type === "assignment") {
          const who = typeof meta.userId === "string" ? (staffNames[meta.userId] ?? "a team member") : "nobody";
          const role = meta.role === "account_manager" ? "Account manager set to" : `${ENTITY_LABEL[a.entityType] ?? "Record"} assigned to`;
          summary = (
            <span>
              {role} <span className="font-medium">{who}</span>
            </span>
          );
        } else {
          summary = <span className="font-medium">{ACTIVITY_TYPE_LABELS[a.type]}</span>;
        }
        return (
          <li key={a.id} className="flex items-start gap-3 px-4 py-2.5 text-[13px]">
            <span aria-hidden className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-subtle text-muted [&_svg]:size-3.5">
              {ICONS[a.type]}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-ink">
                {summary}
                {href ? (
                  <>
                    {" · "}
                    <Link href={href} className="text-muted hover:text-brand hover:underline">
                      {ENTITY_LABEL[a.entityType]}
                    </Link>
                  </>
                ) : null}
              </p>
              {a.body ? <p className="mt-0.5 whitespace-pre-line wrap-break-word text-muted">{a.body}</p> : null}
              <p className="mt-0.5 text-[12px] text-faint">{a.actorName ?? "System"}</p>
            </div>
            <time className="tabular shrink-0 text-[12px] text-faint" dateTime={a.occurredAt.toISOString()}>
              {timeFmt.format(a.occurredAt)}
            </time>
          </li>
        );
      })}
    </ol>
  );
}
