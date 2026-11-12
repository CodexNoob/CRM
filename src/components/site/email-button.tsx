"use client";

import type { ReactNode } from "react";

/**
 * Opens a new message to the firm in one click.
 * - Phones/tablets: the `mailto:` link opens the device's mail app (Gmail, Mail, Outlook).
 * - Computers: many people use Gmail in the browser with no mail app set up, where `mailto:`
 *   does nothing. So on desktop we open Gmail's compose window in a new tab instead.
 * Without JavaScript it falls back to the plain `mailto:` link.
 */
export function EmailButton({ email, subject, className, children }: { email: string; subject?: string; className?: string; children: ReactNode }) {
  const mailto = `mailto:${email}${subject ? `?subject=${encodeURIComponent(subject)}` : ""}`;
  const gmail =
    `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(email)}` + (subject ? `&su=${encodeURIComponent(subject)}` : "");

  return (
    <a
      href={mailto}
      className={className}
      onClick={(e) => {
        const isTouchDevice = window.matchMedia("(pointer: coarse)").matches || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
        if (isTouchDevice) return; // let the phone's mail app handle mailto:
        e.preventDefault();
        // Not passing "noopener" here because it makes window.open return null, hiding a blocked pop-up.
        const tab = window.open(gmail, "_blank");
        if (tab) tab.opener = null;
        else window.location.href = mailto; // pop-up blocked: fall back to the mail app
      }}
    >
      {children}
    </a>
  );
}
