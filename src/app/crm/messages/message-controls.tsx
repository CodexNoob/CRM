"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, MessageSquarePlus, Paperclip, UserPlus } from "lucide-react";
import { assignConversationAction, createConversationAction, setConversationStatusAction, updateConversationAction } from "@/app/actions/messages";
import { Dialog } from "@/components/dialog";
import { FormMessage, SelectField, SubmitButton, TextField, inputClass, textareaClass } from "@/components/form";
import { Menu } from "@/components/menu";
import { useToast } from "@/components/toast";
import { buttonClass, cx } from "@/components/ui";
import type { ConversationCategory, ConversationStatus } from "@/db/schema";
import { idleState } from "@/lib/action-state";
import { ACCEPT_ATTRIBUTE } from "@/lib/file-rules";
import { CONVERSATION_CATEGORY_LABELS, CONVERSATION_STATUS_LABELS } from "./conversation-labels";

type Option = { id: string; name: string };

const categoryOptions = Object.entries(CONVERSATION_CATEGORY_LABELS).map(([value, label]) => ({ value, label }));
const priorityOptions = [
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];

/** "New conversation" button + dialog. Pass `clientId` to start from a client page. */
export function NewConversationButton({ clients, staff, clientId, canAssign, label = "New conversation" }: { clients: Option[]; staff: Option[]; clientId?: string; canAssign: boolean; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={buttonClass("primary")}>
        <MessageSquarePlus /> {label}
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="New conversation" description="The first message is visible to the client in their portal." size="lg">
        <NewConversationForm clients={clients} staff={staff} clientId={clientId} canAssign={canAssign} />
      </Dialog>
    </>
  );
}

function NewConversationForm({ clients, staff, clientId, canAssign }: { clients: Option[]; staff: Option[]; clientId?: string; canAssign: boolean }) {
  const [state, action] = useActionState(createConversationAction, idleState);
  return (
    <form action={action} className="space-y-3" noValidate>
      <FormMessage state={state} />
      {clientId ? (
        <input type="hidden" name="clientId" value={clientId} />
      ) : (
        <SelectField name="clientId" label="Client" required state={state} placeholder="Choose a client" options={clients.map((c) => ({ value: c.id, label: c.name }))} />
      )}
      <TextField name="subject" label="Subject" required state={state} placeholder="2026 tax return — questions" />
      <div className="grid gap-3 sm:grid-cols-3">
        <SelectField name="category" label="Category" state={state} options={categoryOptions} defaultValue="general_inquiry" />
        <SelectField name="priority" label="Priority" state={state} options={priorityOptions} defaultValue="normal" />
        {canAssign ? <SelectField name="assignedStaffId" label="Assign to" state={state} placeholder="Unassigned" options={staff.map((s) => ({ value: s.id, label: s.name }))} /> : null}
      </div>
      <div className="space-y-1.5">
        <label htmlFor="new-body" className="block text-[12.5px] font-medium text-ink">
          Message<span className="text-danger" aria-hidden> *</span>
        </label>
        <textarea id="new-body" name="body" rows={5} maxLength={5000} required defaultValue={state.values?.body} className={textareaClass} />
        {state.fieldErrors?.body ? <p className="text-[12px] text-danger-ink">{state.fieldErrors.body.join(" ")}</p> : null}
      </div>
      <label className="flex items-center gap-2 text-[12.5px] text-muted">
        <Paperclip className="size-3.5" aria-hidden /> Attachments (optional, up to 5)
        <input type="file" name="attachments" multiple accept={ACCEPT_ATTRIBUTE} className="text-[12px]" />
      </label>
      <div className="flex justify-end">
        <SubmitButton pendingText="Sending…">Send message</SubmitButton>
      </div>
    </form>
  );
}

/** Status, category, priority and assignment controls for one conversation. */
export function ConversationControls({
  conversationId,
  status,
  category,
  priority,
  assignee,
  staff,
  can,
}: {
  conversationId: string;
  status: ConversationStatus;
  category: ConversationCategory;
  priority: string;
  assignee: Option | null;
  staff: Option[];
  can: { close: boolean; assign: boolean; edit: boolean };
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [assignOpen, setAssignOpen] = useState(false);
  const [assigneeId, setAssigneeId] = useState(assignee?.id ?? "");
  const run = (fn: () => Promise<import("@/lib/action-state").ActionState>) =>
    start(async () => {
      toast.fromState(await fn());
      router.refresh();
    });

  const statuses = (Object.keys(CONVERSATION_STATUS_LABELS) as ConversationStatus[]).filter((s) => can.close || (s !== "resolved" && s !== "closed"));

  return (
    <div className="flex flex-wrap items-center gap-2">
      {can.edit ? (
        <Menu
          label="Change status"
          triggerClassName={cx(buttonClass("secondary", undefined, "sm"), "gap-1")}
          trigger={
            <>
              {CONVERSATION_STATUS_LABELS[status]} <ChevronDown className="size-3.5" aria-hidden />
            </>
          }
          items={statuses.map((s) => ({ label: CONVERSATION_STATUS_LABELS[s], disabled: pending || s === status, onSelect: () => run(() => setConversationStatusAction(conversationId, s)) }))}
        />
      ) : null}
      {can.edit ? (
        <>
          <label htmlFor="conv-category" className="sr-only">Category</label>
          <select id="conv-category" defaultValue={category} disabled={pending} onChange={(e) => run(() => updateConversationAction(conversationId, { category: e.target.value }))} className={cx(inputClass, "h-8 w-auto")}>
            {categoryOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <label htmlFor="conv-priority" className="sr-only">Priority</label>
          <select id="conv-priority" defaultValue={priority} disabled={pending} onChange={(e) => run(() => updateConversationAction(conversationId, { priority: e.target.value }))} className={cx(inputClass, "h-8 w-auto")}>
            {priorityOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label} priority</option>
            ))}
          </select>
        </>
      ) : null}
      {can.assign ? (
        <>
          <button type="button" onClick={() => setAssignOpen(true)} className={buttonClass("secondary", undefined, "sm")}>
            <UserPlus /> {assignee ? `Assigned: ${assignee.name}` : "Assign"}
          </button>
          <Dialog
            open={assignOpen}
            onClose={() => setAssignOpen(false)}
            title={assignee ? "Reassign conversation" : "Assign conversation"}
            description="The staff member gets access to this client and a notification."
            size="sm"
            footer={
              <>
                <button type="button" onClick={() => setAssignOpen(false)} className={buttonClass("ghost")}>Cancel</button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    setAssignOpen(false);
                    run(() => assignConversationAction(conversationId, assigneeId || null));
                  }}
                  className={buttonClass("primary")}
                >
                  Save
                </button>
              </>
            }
          >
            <label htmlFor="assignee" className="mb-1.5 block text-[12.5px] font-medium text-ink">Assign to</label>
            <select id="assignee" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className={inputClass}>
              <option value="">Unassigned</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </Dialog>
        </>
      ) : assignee ? (
        <span className="text-[12.5px] text-muted">Assigned to {assignee.name}</span>
      ) : null}
    </div>
  );
}
