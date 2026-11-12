"use client";

import { useActionState, useEffect, useRef } from "react";
import { Lock, SendHorizontal } from "lucide-react";
import { FormMessage, SubmitButton, textareaClass } from "@/components/form";
import { idleState, type ActionState } from "@/lib/action-state";
import { cx } from "./ui";

export interface ThreadItem {
  id: string;
  body: string;
  mine: boolean;
  fromClient: boolean;
  authorName: string | null;
  createdAt: string;
}

const fmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function MessageThread({
  messages,
  action,
  emptyText,
  placeholder = "Write a message…",
}: {
  messages: ThreadItem[];
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  emptyText: string;
  placeholder?: string;
}) {
  const [state, formAction] = useActionState(action, idleState);
  const formRef = useRef<HTMLFormElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state.status === "success") formRef.current?.reset();
  }, [state]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="min-h-48 flex-1 space-y-3 overflow-y-auto rounded-md border border-line bg-hover p-3 lg:max-h-none max-h-[55dvh]" aria-live="polite">
        {messages.length === 0 ? (
          <p className="py-10 text-center text-[13px] text-muted">{emptyText}</p>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={m.mine ? "flex justify-end" : "flex justify-start"}>
              <div className={cx("max-w-[85%] rounded-lg px-3 py-2 sm:max-w-[70%]", m.mine ? "bg-brand text-white" : "border border-line bg-surface text-ink")}>
                <p className="whitespace-pre-wrap wrap-break-word text-[13px] leading-5">{m.body}</p>
                <p className={cx("mt-1 text-[11px]", m.mine ? "text-white/70" : "text-faint")}>
                  {m.mine ? "You" : (m.authorName ?? "Unknown")} · {fmt.format(new Date(m.createdAt))}
                </p>
              </div>
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>
      <form ref={formRef} action={formAction} className="space-y-2" noValidate>
        {state.status === "error" ? <FormMessage state={{ ...state, message: state.fieldErrors?._form?.join(" ") ?? state.message }} /> : null}
        <label htmlFor="body" className="sr-only">Message</label>
        <textarea
          id="body"
          name="body"
          rows={3}
          maxLength={5000}
          required
          placeholder={placeholder}
          defaultValue={state.status === "error" ? state.values?.body : undefined}
          className={cx(textareaClass, "resize-y")}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) formRef.current?.requestSubmit();
          }}
        />
        <div className="flex items-center justify-between gap-3">
          <p className="flex items-center gap-1.5 text-[12px] text-muted">
            <Lock className="size-3" aria-hidden />
            Private to the client and the firm. Don’t include full SSNs or account numbers.
          </p>
          <SubmitButton pendingText="Sending…">
            <SendHorizontal /> Send
          </SubmitButton>
        </div>
      </form>
    </div>
  );
}
