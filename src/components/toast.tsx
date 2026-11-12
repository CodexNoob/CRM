"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { CircleCheck, CircleAlert, X } from "lucide-react";
import { cx } from "./ui";
import type { ActionState } from "@/lib/action-state";

/**
 * Lightweight toasts for action feedback ("Stage updated.", errors). Announced to screen
 * readers via a polite live region; errors stay until dismissed, successes fade after 4s.
 *
 *   const toast = useToast();
 *   toast.fromState(await someAction());   // or toast.success("Saved") / toast.error("…")
 */

type Toast = { id: number; tone: "success" | "error"; text: string };
type ToastApi = { success: (t: string) => void; error: (t: string) => void; fromState: (s: ActionState) => void };

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((tone: Toast["tone"], text: string) => {
    setToasts((t) => [...t.slice(-3), { id: Date.now() + Math.random(), tone, text }]);
  }, []);
  const api: ToastApi = {
    success: (t) => push("success", t),
    error: (t) => push("error", t),
    fromState: (s) => {
      if (s.status === "success" && s.message) push("success", s.message);
      if (s.status === "error") push("error", s.fieldErrors?._form?.join(" ") || s.message || "Something went wrong.");
    },
  };
  const dismiss = (id: number) => setToasts((t) => t.filter((x) => x.id !== id));

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div aria-live="polite" role="status" className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 sm:items-end sm:pr-6">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  useEffect(() => {
    if (toast.tone === "error") return;
    const id = setTimeout(onDismiss, 4000);
    return () => clearTimeout(id);
  }, [toast.tone, onDismiss]);
  return (
    <div
      className={cx(
        "pointer-events-auto flex w-full max-w-sm items-start gap-2 rounded-lg border px-3 py-2.5 text-[13px] shadow-lg",
        toast.tone === "success" ? "border-success/30 bg-surface text-ink" : "border-danger/30 bg-danger-soft text-danger-ink",
      )}
    >
      {toast.tone === "success" ? <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden /> : <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />}
      <span className="min-w-0 flex-1">{toast.text}</span>
      <button type="button" onClick={onDismiss} className="-m-1 rounded p-1 text-muted hover:text-ink" aria-label="Dismiss">
        <X className="size-3.5" />
      </button>
    </div>
  );
}

/** Falls back to a no-op outside the provider, so components never crash. */
export function useToast(): ToastApi {
  return useContext(ToastContext) ?? { success: () => {}, error: () => {}, fromState: () => {} };
}
