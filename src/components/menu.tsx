"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cx } from "./ui";

export type MenuItem =
  | { type?: "item"; label: string; icon?: ReactNode; href?: string; onSelect?: () => void; danger?: boolean; disabled?: boolean }
  | { type: "separator" }
  | { type: "label"; label: string };

/**
 * Accessible dropdown menu: button with aria-haspopup, arrow-key navigation,
 * Escape / outside-click to close, focus returned to the trigger.
 */
export function Menu({
  trigger,
  label,
  items,
  align = "end",
  triggerClassName,
  width = "w-52",
}: {
  trigger: ReactNode;
  label: string;
  items: MenuItem[];
  align?: "start" | "end";
  triggerClassName?: string;
  width?: string;
}) {
  const [open, setOpen] = useState(false);
  // Fixed positioning so menus are never clipped by scrolling containers (e.g. wide tables).
  const [pos, setPos] = useState<{ top: number; left?: number; right?: number } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const first = list.current?.querySelector<HTMLElement>("[role=menuitem]:not([aria-disabled=true])");
    first?.focus();
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onMove = () => setOpen(false);
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [open]);

  const close = (focus = true) => {
    setOpen(false);
    if (focus) button.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const els = [...(list.current?.querySelectorAll<HTMLElement>("[role=menuitem]:not([aria-disabled=true])") ?? [])];
    const i = els.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      els.at((i + 1) % els.length)?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      els.at((i - 1 + els.length) % els.length)?.focus();
    } else if (e.key === "Tab") {
      close(false);
    }
  };

  return (
    <div ref={root} className="relative inline-flex">
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        aria-label={label}
        onClick={(e) => {
          e.stopPropagation();
          const r = button.current!.getBoundingClientRect();
          setPos(align === "end" ? { top: r.bottom + 4, right: window.innerWidth - r.right } : { top: r.bottom + 4, left: r.left });
          setOpen((v) => !v);
        }}
        className={triggerClassName}
      >
        {trigger}
      </button>
      {open ? (
        <div
          ref={list}
          id={id}
          role="menu"
          aria-label={label}
          onKeyDown={onKeyDown}
          onClick={(e) => e.stopPropagation()}
          className={cx(
            "fixed z-50 max-h-[70dvh] overflow-y-auto rounded-lg border border-line bg-surface py-1 shadow-lg",
            width,
          )}
          style={pos ? { top: pos.top, left: pos.left, right: pos.right } : undefined}
        >
          {items.map((item, i) => {
            if (item.type === "separator") return <div key={i} role="separator" className="my-1 border-t border-line" />;
            if (item.type === "label") return <p key={i} className="px-3 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-faint">{item.label}</p>;
            const cls = cx(
              "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] outline-none [&_svg]:size-4 [&_svg]:text-muted",
              item.disabled ? "cursor-not-allowed text-faint" : item.danger ? "text-danger-ink hover:bg-danger-soft focus:bg-danger-soft [&_svg]:text-danger-ink" : "text-ink hover:bg-subtle focus:bg-subtle",
            );
            if (item.href && !item.disabled) {
              return (
                <Link key={i} href={item.href} role="menuitem" tabIndex={-1} className={cls} onClick={() => setOpen(false)}>
                  {item.icon}
                  {item.label}
                </Link>
              );
            }
            return (
              <button
                key={i}
                type="button"
                role="menuitem"
                tabIndex={-1}
                aria-disabled={item.disabled || undefined}
                className={cls}
                onClick={() => {
                  if (item.disabled) return;
                  setOpen(false);
                  item.onSelect?.();
                }}
              >
                {item.icon}
                {item.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
