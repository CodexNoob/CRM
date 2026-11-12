import type { ReactNode } from "react";
import { cx } from "./ui";

/** Compact static table for dashboard panels and detail pages (no client-side features). */
export function SimpleTable({ headers, children, label, className }: { headers: { label: string; align?: "right"; hideBelow?: "sm" | "md" | "lg" }[]; children: ReactNode; label: string; className?: string }) {
  const hide = { sm: "hidden sm:table-cell", md: "hidden md:table-cell", lg: "hidden lg:table-cell" };
  return (
    <div className={cx("overflow-x-auto", className)}>
      <table className="w-full border-collapse text-left text-[13px]" aria-label={label}>
        <thead>
          <tr className="border-b border-line bg-hover">
            {headers.map((h) => (
              <th key={h.label} scope="col" className={cx("whitespace-nowrap px-4 py-2 text-[12px] font-medium text-muted", h.align === "right" && "text-right", h.hideBelow && hide[h.hideBelow])}>
                {h.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&>tr]:border-b [&>tr]:border-line [&>tr:last-child]:border-b-0 [&>tr:hover]:bg-hover">{children}</tbody>
      </table>
    </div>
  );
}

export const td = "px-4 py-2.5 align-middle";
export const tdHide = { sm: "hidden sm:table-cell", md: "hidden md:table-cell", lg: "hidden lg:table-cell" };
