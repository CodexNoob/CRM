"use client";

import { RotateCw, TriangleAlert } from "lucide-react";
import { buttonClass } from "@/components/ui";

export default function StaffError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto mt-10 max-w-md rounded-lg border border-line bg-surface p-6 text-center">
      <div className="mx-auto mb-3 flex size-9 items-center justify-center rounded-md border border-danger/25 bg-danger-soft text-danger-ink">
        <TriangleAlert className="size-4" aria-hidden />
      </div>
      <h1 className="text-[15px] font-semibold text-ink">This page couldn’t be loaded</h1>
      <p className="mt-1 text-[13px] text-muted">Nothing was changed. Try again; if it keeps happening, contact your administrator.</p>
      {error.digest ? <p className="mt-2 font-mono text-[11.5px] text-faint">Reference: {error.digest}</p> : null}
      <button type="button" onClick={reset} className={buttonClass("secondary", "mt-4")}>
        <RotateCw /> Try again
      </button>
    </div>
  );
}
