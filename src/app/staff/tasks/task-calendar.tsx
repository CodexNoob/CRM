import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ButtonLink, cx } from "@/components/ui";
import { TASK_STATUS_LABELS } from "@/lib/labels";
import type { TaskRowData } from "./tasks-table";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const isOpen = (s: TaskRowData["status"]) => s !== "completed" && s !== "cancelled";

function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

/** Month grid of tasks by due date (server-rendered; navigation is plain links). */
export function TaskCalendar({ rows, month, today, hrefFor }: { rows: TaskRowData[]; month: string; today: string; hrefFor: (month: string) => string }) {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const first = new Date(Date.UTC(y, m - 1, 1));
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7; // Monday-first
  const cells: (string | null)[] = [...Array.from({ length: lead }, () => null), ...Array.from({ length: daysInMonth }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`)];
  while (cells.length % 7) cells.push(null);

  const byDay = new Map<string, TaskRowData[]>();
  for (const r of rows) if (r.dueDate?.startsWith(month)) byDay.set(r.dueDate, [...(byDay.get(r.dueDate) ?? []), r]);
  const undated = rows.filter((r) => !r.dueDate).length;
  const title = first.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <section aria-label={`Tasks due in ${title}`} className="rounded-lg border border-line bg-surface">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
        <ButtonLink href={hrefFor(shiftMonth(month, -1))} variant="ghost" size="sm" aria-label="Previous month">
          <ChevronLeft />
        </ButtonLink>
        <h2 className="text-[14px] font-semibold text-ink">{title}</h2>
        <div className="flex items-center gap-1">
          {month !== today.slice(0, 7) ? (
            <ButtonLink href={hrefFor(today.slice(0, 7))} variant="ghost" size="sm">
              Today
            </ButtonLink>
          ) : null}
          <ButtonLink href={hrefFor(shiftMonth(month, 1))} variant="ghost" size="sm" aria-label="Next month">
            <ChevronRight />
          </ButtonLink>
        </div>
      </div>
      <div className="overflow-x-auto">
        <div className="grid min-w-[44rem] grid-cols-7 text-[12px]">
          {WEEKDAYS.map((d) => (
            <div key={d} className="border-b border-line px-2 py-1.5 font-medium text-muted">
              {d}
            </div>
          ))}
          {cells.map((day, i) => {
            const list = day ? (byDay.get(day) ?? []) : [];
            return (
              <div key={i} className={cx("min-h-24 border-b border-r border-line p-1.5 [&:nth-child(7n)]:border-r-0", !day && "bg-subtle/40", day === today && "bg-brand-soft/40")}>
                {day ? <div className={cx("mb-1 tabular", day === today ? "font-semibold text-brand-ink" : "text-muted")}>{Number(day.slice(8))}</div> : null}
                <ul className="space-y-1">
                  {list.slice(0, 4).map((r) => {
                    const overdue = isOpen(r.status) && day! < today;
                    return (
                      <li key={r.id}>
                        <Link
                          href={`/staff/tasks/${r.id}`}
                          title={`${r.title} — ${TASK_STATUS_LABELS[r.status]}`}
                          className={cx(
                            "block truncate rounded px-1.5 py-0.5 hover:underline",
                            !isOpen(r.status) ? "bg-subtle text-faint line-through" : overdue ? "bg-danger-soft font-medium text-danger-ink" : "bg-info-soft text-ink",
                          )}
                        >
                          {r.title}
                        </Link>
                      </li>
                    );
                  })}
                  {list.length > 4 ? <li className="px-1.5 text-faint">+{list.length - 4} more</li> : null}
                </ul>
              </div>
            );
          })}
        </div>
      </div>
      {undated ? <p className="border-t border-line px-3 py-2 text-[12px] text-muted">{undated} task(s) without a due date aren’t shown. Use the list view to see them.</p> : null}
    </section>
  );
}
