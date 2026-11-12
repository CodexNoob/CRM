"use client";

import { useState } from "react";
import { buttonClass } from "./ui";

/** Shows a one-time sign-in link with a copy button. */
export function InviteLink({ link, id = "invite-link" }: { link: string; id?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="sr-only">
        Sign-in link
      </label>
      <input
        id={id}
        readOnly
        value={link}
        className="w-full rounded-md border border-line bg-subtle px-2 py-2 font-mono text-xs"
        onFocus={(e) => e.currentTarget.select()}
      />
      <button
        type="button"
        className={buttonClass("secondary", "w-full")}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(link);
            setCopied(true);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? "Copied" : "Copy link"}
      </button>
    </div>
  );
}
