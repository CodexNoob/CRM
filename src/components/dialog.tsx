"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { cx } from "./ui";

/**
 * Accessible modal dialog (native <dialog>: focus trap, Escape, inert background).
 * Controlled: render it with `open` and handle `onClose`.
 *
 *   <Dialog open={open} onClose={() => setOpen(false)} title="Convert to client">…</Dialog>
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  /** Usually the action buttons. */
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby="dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={cx(
        "m-auto max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-xl border border-line bg-surface p-0 text-ink shadow-xl backdrop:bg-ink/50 backdrop:backdrop-blur-[2px]",
        size === "sm" ? "w-[min(26rem,calc(100vw-2rem))]" : size === "lg" ? "w-[min(48rem,calc(100vw-2rem))]" : "w-[min(36rem,calc(100vw-2rem))]",
      )}
    >
      {open ? (
        <>
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-3.5">
            <div className="min-w-0">
              <h2 id="dialog-title" className="text-[15px] font-semibold">
                {title}
              </h2>
              {description ? <div className="mt-0.5 text-[13px] text-muted">{description}</div> : null}
            </div>
            <button type="button" onClick={onClose} className="-mr-1 inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted hover:bg-subtle hover:text-ink" aria-label="Close">
              <X className="size-4" />
            </button>
          </div>
          <div className="px-5 py-4">{children}</div>
          {footer ? <div className="flex flex-wrap justify-end gap-2 border-t border-line bg-hover px-5 py-3">{footer}</div> : null}
        </>
      ) : null}
    </dialog>
  );
}
