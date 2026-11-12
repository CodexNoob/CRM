"use client";

import { Alert, buttonClass } from "@/components/ui";

export default function PortalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="space-y-4">
      <Alert tone="error">We couldn’t load your portal just now. Please try again in a moment.</Alert>
      <button type="button" onClick={reset} className={buttonClass("secondary")}>
        Try again
      </button>
    </div>
  );
}
