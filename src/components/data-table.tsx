"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown, MoreHorizontal, Search, X } from "lucide-react";
import type { ActionState } from "@/lib/action-state";
import { Menu, type MenuItem } from "./menu";
import { Alert, EmptyState, buttonClass, cx } from "./ui";

/*
 * DataTable: the standard way to show structured records.
 * Rows arrive from the server already authorised; this component only adds
 * client-side search, filters, sorting, paging, selection, bulk and row actions.
 */

export interface Column<T> {
  id: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Enables sorting on this column. */
  sort?: (row: T) => string | number | null | undefined;
  align?: "left" | "right";
  /** Hide on narrow screens to keep tables readable on tablets/phones. */
  hideBelow?: "sm" | "md" | "lg";
  className?: string;
  width?: string;
}

export interface Filter<T> {
  id: string;
  label: string;
  options: { value: string; label: string }[];
  match: (row: T, value: string) => boolean;
}

export interface BulkAction {
  label: string;
  icon?: ReactNode;
  variant?: "secondary" | "danger";
  confirm?: string;
  run: (ids: string[]) => Promise<ActionState | void>;
}

const hideClass = { sm: "hidden sm:table-cell", md: "hidden md:table-cell", lg: "hidden lg:table-cell" };

export function DataTable<T>({
  rows,
  columns,
  getId,
  search,
  filters = [],
  bulkActions,
  rowActions,
  rowHref,
  initialSort,
  pageSize = 25,
  empty,
  toolbar,
  label,
}: {
  rows: T[];
  columns: Column<T>[];
  getId: (row: T) => string;
  search?: { placeholder: string; text: (row: T) => string };
  filters?: Filter<T>[];
  bulkActions?: BulkAction[];
  rowActions?: (row: T) => MenuItem[];
  rowHref?: (row: T) => string | null;
  initialSort?: { id: string; dir: "asc" | "desc" };
  pageSize?: number;
  empty: { title: string; body?: ReactNode; action?: ReactNode; icon?: ReactNode };
  toolbar?: ReactNode;
  label: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const [sort, setSort] = useState(initialSort ?? null);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<ActionState | null>(null);
  const [pending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = rows.filter((r) => (!q || !search ? true : search.text(r).toLowerCase().includes(q)));
    for (const f of filters) {
      const v = filterValues[f.id];
      if (v) out = out.filter((r) => f.match(r, v));
    }
    if (sort) {
      const col = columns.find((c) => c.id === sort.id);
      if (col?.sort) {
        const dir = sort.dir === "asc" ? 1 : -1;
        out = [...out].sort((a, b) => {
          const x = col.sort!(a);
          const y = col.sort!(b);
          if (x === y) return 0;
          if (x === null || x === undefined || x === "") return 1;
          if (y === null || y === undefined || y === "") return -1;
          return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * dir;
        });
      }
    }
    return out;
  }, [rows, query, filterValues, sort, columns, filters, search]);

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const current = Math.min(page, pages - 1);
  const visible = filtered.slice(current * pageSize, current * pageSize + pageSize);
  const visibleIds = visible.map(getId);
  const allOnPage = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const hasSelection = !!bulkActions?.length;
  const activeFilters = Object.values(filterValues).filter(Boolean).length + (query ? 1 : 0);

  const toggleSort = (id: string) => {
    setSort((s) => (!s || s.id !== id ? { id, dir: "asc" } : s.dir === "asc" ? { id, dir: "desc" } : null));
  };

  const runBulk = (a: BulkAction) => {
    const ids = [...selected];
    if (a.confirm && !window.confirm(a.confirm.replace("{n}", String(ids.length)))) return;
    startTransition(async () => {
      const r = await a.run(ids);
      setResult(r ?? { status: "success", message: `${a.label}: done.` });
      if (!r || r.status !== "error") setSelected(new Set());
      router.refresh();
    });
  };

  return (
    <div className="self-start overflow-hidden rounded-lg border border-line bg-surface">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        {search ? (
          <div className="relative w-full sm:w-64">
            <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
            <input
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
              placeholder={search.placeholder}
              aria-label={search.placeholder}
              className="h-8 w-full rounded-md border border-line bg-surface pl-8 pr-2 text-[13px] placeholder:text-faint hover:border-line-strong focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/15"
            />
          </div>
        ) : null}
        {filters.map((f) => (
          <label key={f.id} className="relative">
            <span className="sr-only">{f.label}</span>
            <select
              value={filterValues[f.id] ?? ""}
              onChange={(e) => {
                setFilterValues((v) => ({ ...v, [f.id]: e.target.value }));
                setPage(0);
              }}
              className={cx(
                "h-8 rounded-md border bg-surface pl-2.5 pr-7 text-[13px] hover:border-line-strong focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/15",
                filterValues[f.id] ? "border-brand/40 text-ink" : "border-line text-muted",
              )}
            >
              <option value="">{f.label}: All</option>
              {f.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {f.label}: {o.label}
                </option>
              ))}
            </select>
          </label>
        ))}
        {activeFilters ? (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setFilterValues({});
              setPage(0);
            }}
            className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-[12.5px] text-muted hover:bg-subtle hover:text-ink"
          >
            <X className="size-3.5" aria-hidden /> Clear
          </button>
        ) : null}
        <div className="ml-auto flex items-center gap-2">{toolbar}</div>
      </div>

      {/* Bulk action bar */}
      {hasSelection && selected.size > 0 ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-brand-soft/60 px-3 py-1.5" role="region" aria-label="Bulk actions">
          <span className="text-[12.5px] font-medium text-brand">{selected.size} selected</span>
          <span className="mx-1 h-4 w-px bg-line-strong" aria-hidden />
          {bulkActions!.map((a) => (
            <button key={a.label} type="button" disabled={pending} onClick={() => runBulk(a)} className={buttonClass(a.variant ?? "secondary", undefined, "sm")}>
              {a.icon}
              {a.label}
            </button>
          ))}
          <button type="button" onClick={() => setSelected(new Set())} className="ml-auto text-[12.5px] text-muted hover:text-ink">
            Clear selection
          </button>
        </div>
      ) : null}
      {result?.message ? (
        <div className="border-b border-line px-3 py-2">
          <Alert tone={result.status === "error" ? "error" : "success"}>{result.message}</Alert>
        </div>
      ) : null}

      {/* Table */}
      {filtered.length === 0 ? (
        <EmptyState title={rows.length === 0 ? empty.title : "No matching records"} icon={empty.icon} action={rows.length === 0 ? empty.action : undefined}>
          {rows.length === 0 ? empty.body : "Try a different search or clear the filters."}
        </EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-[13px]" aria-label={label}>
            <thead>
              <tr className="border-b border-line bg-hover">
                {hasSelection ? (
                  <th scope="col" className="w-10 px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label={allOnPage ? "Deselect all on this page" : "Select all on this page"}
                      checked={allOnPage}
                      onChange={() =>
                        setSelected((s) => {
                          const n = new Set(s);
                          for (const id of visibleIds) {
                            if (allOnPage) n.delete(id);
                            else n.add(id);
                          }
                          return n;
                        })
                      }
                      className="size-3.5 rounded border-line-strong accent-brand"
                    />
                  </th>
                ) : null}
                {columns.map((c) => {
                  const active = sort?.id === c.id;
                  return (
                    <th
                      key={c.id}
                      scope="col"
                      aria-sort={active ? (sort!.dir === "asc" ? "ascending" : "descending") : undefined}
                      className={cx("whitespace-nowrap px-3 py-2 text-[12px] font-medium text-muted", c.align === "right" && "text-right", c.hideBelow && hideClass[c.hideBelow], c.width)}
                    >
                      {c.sort ? (
                        <button type="button" onClick={() => toggleSort(c.id)} className={cx("inline-flex items-center gap-1 rounded hover:text-ink", active && "text-ink", c.align === "right" && "flex-row-reverse")}>
                          {c.header}
                          {active ? (
                            sort!.dir === "asc" ? <ArrowUp className="size-3" aria-hidden /> : <ArrowDown className="size-3" aria-hidden />
                          ) : (
                            <ChevronsUpDown className="size-3 opacity-50" aria-hidden />
                          )}
                        </button>
                      ) : (
                        c.header
                      )}
                    </th>
                  );
                })}
                {rowActions ? <th scope="col" className="w-10 px-2 py-2"><span className="sr-only">Actions</span></th> : null}
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const id = getId(row);
                const href = rowHref?.(row) ?? null;
                const isSel = selected.has(id);
                return (
                  <tr
                    key={id}
                    onClick={(e) => {
                      if (!href) return;
                      const t = e.target as HTMLElement;
                      if (t.closest("a,button,input,select,label,[role=menu]")) return;
                      router.push(href);
                    }}
                    className={cx("border-b border-line last:border-b-0", href && "cursor-pointer", isSel ? "bg-brand-soft/40" : "hover:bg-hover")}
                  >
                    {hasSelection ? (
                      <td className="px-3 py-2.5">
                        <input
                          type="checkbox"
                          aria-label="Select row"
                          checked={isSel}
                          onChange={() =>
                            setSelected((s) => {
                              const n = new Set(s);
                              if (n.has(id)) n.delete(id);
                              else n.add(id);
                              return n;
                            })
                          }
                          className="size-3.5 rounded border-line-strong accent-brand"
                        />
                      </td>
                    ) : null}
                    {columns.map((c, ci) => (
                      <td key={c.id} className={cx("px-3 py-2.5 align-middle", ci > 0 && "whitespace-nowrap", c.align === "right" && "text-right tabular", c.hideBelow && hideClass[c.hideBelow], c.className)}>
                        {c.cell(row)}
                      </td>
                    ))}
                    {rowActions ? (
                      <td className="px-2 py-1.5 text-right">
                        <Menu
                          label="Row actions"
                          items={rowActions(row)}
                          trigger={<MoreHorizontal className="size-4" aria-hidden />}
                          triggerClassName="inline-flex size-7 items-center justify-center rounded-md text-muted hover:bg-subtle hover:text-ink"
                        />
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Footer / pagination */}
      {filtered.length > 0 ? (
        <div className="flex items-center justify-between gap-3 border-t border-line px-3 py-2 text-[12.5px] text-muted">
          <span className="tabular">
            {current * pageSize + 1}–{Math.min(filtered.length, (current + 1) * pageSize)} of {filtered.length}
            {filtered.length !== rows.length ? ` (filtered from ${rows.length})` : ""}
          </span>
          {pages > 1 ? (
            <div className="flex items-center gap-1">
              <button type="button" aria-label="Previous page" disabled={current === 0} onClick={() => setPage(current - 1)} className={buttonClass("secondary", "w-8 px-0", "sm")}>
                <ChevronLeft />
              </button>
              <span className="tabular px-1">
                Page {current + 1} of {pages}
              </span>
              <button type="button" aria-label="Next page" disabled={current >= pages - 1} onClick={() => setPage(current + 1)} className={buttonClass("secondary", "w-8 px-0", "sm")}>
                <ChevronRight />
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** A primary text cell with an optional secondary line. */
export function CellTitle({ title, sub, href }: { title: ReactNode; sub?: ReactNode; href?: string }) {
  return (
    <div className="min-w-0">
      {href ? (
        <Link href={href} className="font-medium text-ink hover:text-brand hover:underline">
          {title}
        </Link>
      ) : (
        <span className="font-medium text-ink">{title}</span>
      )}
      {sub ? <div className="truncate text-[12px] text-muted">{sub}</div> : null}
    </div>
  );
}
