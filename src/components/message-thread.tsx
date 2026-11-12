"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Lock, Paperclip, SendHorizontal, StickyNote } from "lucide-react";
import { FormMessage, SubmitButton, textareaClass } from "@/components/form";
import { idleState, type ActionState } from "@/lib/action-state";
import { ACCEPT_ATTRIBUTE } from "@/lib/file-rules";
import { cx } from "./ui";

export interface ThreadItem {
  id: string;
  body: string;
  mine: boolean;
  fromClient: boolean;
  authorName: string | null;
  createdAt: string;
  /** Staff-only note. Portal pages never receive these (filtered on the server). */
  isInternal?: boolean;
  attachments?: { id: string; fileName: string; sizeBytes: number }[];
}

const fmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function size(n: number) {
  return n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * A conversation timeline + composer.
 * - `allowInternal` (staff only) adds a Message | Internal note toggle; internal notes are
 *   styled amber and labelled "not visible to client".
 * - `allowAttachments` adds a file picker (field "attachments", up to 5 files).
 * - `disabledReason` replaces the composer (e.g. closed conversation, read-only user).
 */
export function MessageThread({
  messages,
  action,
  emptyText,
  placeholder = "Write a message…",
  allowInternal = false,
  allowAttachments = false,
  disabledReason,
}: {
  messages: ThreadItem[];
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  emptyText: string;
  placeholder?: string;
  allowInternal?: boolean;
  allowAttachments?: boolean;
  disabledReason?: string;
}) {
  const [state, formAction] = useActionState(action, idleState);
  const [mode, setMode] = useState<"message" | "internal">("message");
  const formRef = useRef<HTMLFormElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state.status === "success") formRef.current?.reset();
  }, [state]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);
  const internal = allowInternal && mode === "internal";

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="max-h-[55dvh] min-h-48 flex-1 space-y-3 overflow-y-auto rounded-md border border-line bg-hover p-3 lg:max-h-none" aria-live="polite">
        {messages.length === 0 ? (
          <p className="py-10 text-center text-[13px] text-muted">{emptyText}</p>
        ) : (
          messages.map((m) =>
            m.isInternal ? (
              <div key={m.id} className="flex justify-center">
                <div className="w-full max-w-[92%] rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-ink sm:max-w-[80%]">
                  <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-warning-ink">
                    <StickyNote className="size-3" aria-hidden /> Internal — not visible to client
                  </p>
                  <p className="whitespace-pre-wrap wrap-break-word text-[13px] leading-5">{m.body}</p>
                  <Attachments items={m.attachments} tone="light" />
                  <p className="mt-1 text-[11px] text-muted">
                    {m.mine ? "You" : (m.authorName ?? "Staff")} · {fmt.format(new Date(m.createdAt))}
                  </p>
                </div>
              </div>
            ) : (
              <div key={m.id} className={m.mine ? "flex justify-end" : "flex justify-start"}>
                <div className={cx("max-w-[85%] rounded-lg px-3 py-2 sm:max-w-[70%]", m.mine ? "bg-brand text-white" : "border border-line bg-surface text-ink")}>
                  <p className="whitespace-pre-wrap wrap-break-word text-[13px] leading-5">{m.body}</p>
                  <Attachments items={m.attachments} tone={m.mine ? "dark" : "light"} />
                  <p className={cx("mt-1 text-[11px]", m.mine ? "text-white/70" : "text-faint")}>
                    {m.mine ? "You" : (m.authorName ?? "Unknown")} · {fmt.format(new Date(m.createdAt))}
                  </p>
                </div>
              </div>
            ),
          )
        )}
        <div ref={endRef} />
      </div>

      {disabledReason ? (
        <p className="rounded-md border border-line bg-subtle px-3 py-2 text-[13px] text-muted">{disabledReason}</p>
      ) : (
        <form ref={formRef} action={formAction} className="space-y-2" noValidate>
          {state.status === "error" ? <FormMessage state={{ ...state, message: state.fieldErrors?._form?.join(" ") ?? state.fieldErrors?.body?.join(" ") ?? state.fieldErrors?.attachments?.join(" ") ?? state.message }} /> : null}
          {allowInternal ? (
            <div role="radiogroup" aria-label="Message type" className="inline-flex rounded-md border border-line bg-surface p-0.5 text-[12.5px]">
              {(["message", "internal"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={mode === m}
                  onClick={() => setMode(m)}
                  className={cx("rounded px-2.5 py-1", mode === m ? (m === "internal" ? "bg-warning-soft font-medium text-warning-ink" : "bg-brand-soft font-medium text-brand-ink") : "text-muted hover:text-ink")}
                >
                  {m === "message" ? "Message to client" : "Internal note"}
                </button>
              ))}
            </div>
          ) : null}
          <input type="hidden" name="mode" value={internal ? "internal" : "message"} />
          <label htmlFor="body" className="sr-only">
            {internal ? "Internal note" : "Message"}
          </label>
          <textarea
            id="body"
            name="body"
            rows={3}
            maxLength={5000}
            required
            placeholder={internal ? "Visible to staff only…" : placeholder}
            defaultValue={state.status === "error" ? state.values?.body : undefined}
            className={cx(textareaClass, "resize-y", internal && "border-warning/50 bg-warning-soft/40")}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) formRef.current?.requestSubmit();
            }}
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              {allowAttachments ? (
                <label className="inline-flex cursor-pointer items-center gap-1.5 text-[12.5px] text-muted hover:text-ink">
                  <Paperclip className="size-3.5" aria-hidden />
                  <span>Attach files</span>
                  <input type="file" name="attachments" multiple accept={ACCEPT_ATTRIBUTE} className="max-w-48 text-[12px] file:mr-2 file:rounded file:border file:border-line file:bg-surface file:px-2 file:py-0.5" />
                </label>
              ) : null}
              <p className="flex items-center gap-1.5 text-[12px] text-muted">
                <Lock className="size-3" aria-hidden />
                {internal ? "Only staff can see internal notes." : "Private to the client and the firm. Don’t include full SSNs or account numbers."}
              </p>
            </div>
            <SubmitButton pendingText="Sending…" variant={internal ? "secondary" : "primary"}>
              {internal ? <StickyNote /> : <SendHorizontal />} {internal ? "Add note" : "Send"}
            </SubmitButton>
          </div>
        </form>
      )}
    </div>
  );
}

function Attachments({ items, tone }: { items?: ThreadItem["attachments"]; tone: "light" | "dark" }) {
  if (!items?.length) return null;
  return (
    <ul className="mt-2 space-y-1">
      {items.map((a) => (
        <li key={a.id}>
          <a
            href={`/api/documents/${a.id}`}
            className={cx("inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[12px] underline-offset-2 hover:underline", tone === "dark" ? "bg-white/15 text-white" : "bg-subtle text-ink")}
          >
            <Paperclip className="size-3" aria-hidden />
            {a.fileName} <span className="opacity-70">({size(a.sizeBytes)})</span>
          </a>
        </li>
      ))}
    </ul>
  );
}
