"use client";

import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import { inputClass } from "@/components/form";
import { cx } from "@/components/ui";
import { CLIENT_STATUS_LABELS, CLIENT_TYPE_LABELS, ONBOARDING_STATUS_LABELS } from "@/lib/labels";

/**
 * Server-side filters for the client list. Values live in the URL, so they survive a
 * reload and can be shared as a link.
 */
export function ClientFilters({
  values,
  staff,
}: {
  values: { type: string; status: string; manager: string; onboarding: string; archived: boolean };
  staff: { value: string; label: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, start] = useTransition();

  const set = (key: string, value: string) => {
    const next = new URLSearchParams();
    const merged: Record<string, string> = { ...values, archived: values.archived ? "1" : "", [key]: value };
    for (const [k, v] of Object.entries(merged)) if (v) next.set(k, v);
    const q = next.toString();
    start(() => router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false }));
  };

  const active = Boolean(values.type || values.status || values.manager || values.onboarding || values.archived);
  const select = (id: string, label: string, value: string, options: { value: string; label: string }[], all: string) => (
    <label className="flex min-w-0 flex-col gap-1 text-[12px] text-muted">
      {label}
      <select id={`filter-${id}`} value={value} onChange={(e) => set(id, e.target.value)} className={cx(inputClass, "pr-7")}>
        <option value="">{all}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className={cx("mb-4 grid gap-3 rounded-lg border border-line bg-surface p-3 sm:grid-cols-2 lg:grid-cols-[repeat(4,minmax(0,1fr))_auto]", pending && "opacity-70")} aria-busy={pending}>
      {select("type", "Type", values.type, Object.entries(CLIENT_TYPE_LABELS).map(([value, label]) => ({ value, label })), "All types")}
      {select("status", "Status", values.status, Object.entries(CLIENT_STATUS_LABELS).map(([value, label]) => ({ value, label })), "All statuses")}
      {select("manager", "Account manager", values.manager, [{ value: "none", label: "No account manager" }, ...staff], "Anyone")}
      {select("onboarding", "Onboarding", values.onboarding, Object.entries(ONBOARDING_STATUS_LABELS).map(([value, label]) => ({ value, label })), "Any stage")}
      <div className="flex items-end gap-3">
        <label className="flex h-9 items-center gap-2 text-[13px] text-ink sm:h-8">
          <input type="checkbox" checked={values.archived} onChange={(e) => set("archived", e.target.checked ? "1" : "")} className="size-4 accent-brand" />
          Show archived
        </label>
        {active ? (
          <button type="button" onClick={() => start(() => router.replace(pathname, { scroll: false }))} className="h-9 rounded-md px-2 text-[13px] text-brand-ink hover:bg-subtle sm:h-8">
            Clear
          </button>
        ) : null}
      </div>
    </div>
  );
}
