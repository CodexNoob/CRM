"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, CircleCheck, FileText, Info, Mail, Pencil, Phone, Plus, RotateCcw, ShieldCheck, Trash2, UserRound } from "lucide-react";
import { addOnboardingItemAction, archiveClientAction, removeContactAction, saveContactAction, setOnboardingItemAction } from "@/app/actions/crm";
import { Dialog } from "@/components/dialog";
import { FormMessage, SelectField, SubmitButton, TextField, textareaClass } from "@/components/form";
import { useToast } from "@/components/toast";
import { Badge, buttonClass, EmptyState } from "@/components/ui";
import { idleState, type ActionState } from "@/lib/action-state";
import { CONTACT_ROLE_LABELS, ONBOARDING_STATUS_LABELS } from "@/lib/labels";
import { ONBOARDING_TONE } from "@/lib/status";

/* ───────── Archive / restore ───────── */

export function ArchiveClientButton({ clientId, clientName, archived }: { clientId: string; clientName: string; archived: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const run = () =>
    start(async () => {
      const r = await archiveClientAction(clientId, !archived);
      toast.fromState(r);
      setOpen(false);
      router.refresh();
    });
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={buttonClass("secondary")}>
        {archived ? <ArchiveRestore /> : <Archive />} {archived ? "Restore" : "Archive"}
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        size="sm"
        title={archived ? "Restore client?" : "Archive client?"}
        footer={
          <>
            <button type="button" className={buttonClass("secondary")} onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="button" disabled={pending} className={buttonClass(archived ? "primary" : "danger")} onClick={run}>
              {pending ? "Saving…" : archived ? "Restore" : "Archive"}
            </button>
          </>
        }
      >
        <p className="text-[13px] text-ink">
          {archived
            ? `${clientName} will appear in the client list again.`
            : `${clientName} will be hidden from the client list. Nothing is deleted: engagements, documents, messages and history are kept.`}
        </p>
      </Dialog>
    </>
  );
}

/* ───────── Contacts ───────── */

export interface ContactView {
  id: string;
  name: string;
  title: string | null;
  role: "owner" | "primary" | "billing" | "authorized_representative" | "other";
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
  notes: string | null;
}

const roleOptions = Object.entries(CONTACT_ROLE_LABELS).map(([value, label]) => ({ value, label }));

export function ContactsPanel({ clientId, contacts, canEdit, isBusiness }: { clientId: string; contacts: ContactView[]; canEdit: boolean; isBusiness: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = useState<ContactView | "new" | null>(null);
  const [removing, setRemoving] = useState<ContactView | null>(null);
  const [pending, start] = useTransition();

  const remove = (c: ContactView) =>
    start(async () => {
      const r = await removeContactAction(clientId, c.id);
      toast.fromState(r);
      setRemoving(null);
      router.refresh();
    });

  return (
    <div className="rounded-lg border border-line bg-surface">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <h2 className="text-[14px] font-semibold text-ink">Contacts</h2>
          <p className="text-[12.5px] text-muted">
            {isBusiness ? "People at this business: owner, primary, billing and authorized representatives." : "Other people involved with this client (spouse, representative, preparer contact)."}
          </p>
        </div>
        {canEdit ? (
          <button type="button" onClick={() => setEditing("new")} className={buttonClass("primary", undefined, "sm")}>
            <Plus /> Add contact
          </button>
        ) : null}
      </div>
      {contacts.length ? (
        <ul className="divide-y divide-line">
          {contacts.map((c) => (
            <li key={c.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <span aria-hidden className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-subtle text-muted">
                  <UserRound className="size-4" />
                </span>
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-[13px] font-medium text-ink">
                    {c.name}
                    <Badge tone="brand">{CONTACT_ROLE_LABELS[c.role]}</Badge>
                    {c.isPrimary ? <Badge tone="good">Primary</Badge> : null}
                  </p>
                  <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-[12.5px] text-muted">
                    {c.title ? <span>{c.title}</span> : null}
                    {c.email ? (
                      <a href={`mailto:${c.email}`} className="inline-flex items-center gap-1 hover:text-ink">
                        <Mail className="size-3" aria-hidden /> {c.email}
                      </a>
                    ) : null}
                    {c.phone ? (
                      <a href={`tel:${c.phone.replace(/[^0-9+]/g, "")}`} className="inline-flex items-center gap-1 hover:text-ink">
                        <Phone className="size-3" aria-hidden /> {c.phone}
                      </a>
                    ) : null}
                  </p>
                  {c.notes ? <p className="mt-0.5 text-[12.5px] text-muted">{c.notes}</p> : null}
                </div>
              </div>
              {canEdit ? (
                <div className="flex gap-1 sm:shrink-0">
                  <button type="button" onClick={() => setEditing(c)} className={buttonClass("ghost", undefined, "sm")} aria-label={`Edit ${c.name}`}>
                    <Pencil /> Edit
                  </button>
                  <button type="button" onClick={() => setRemoving(c)} className={buttonClass("ghost", "text-danger-ink", "sm")} aria-label={`Remove ${c.name}`}>
                    <Trash2 /> Remove
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={<UserRound />} title="No contacts yet">
          {isBusiness ? "Add the business owner, primary contact and billing contact." : "Add anyone else you work with for this client."}
        </EmptyState>
      )}

      <Dialog open={!!editing} onClose={() => setEditing(null)} title={editing === "new" ? "Add contact" : "Edit contact"}>
        {editing ? (
          <ContactForm
            key={editing === "new" ? "new" : editing.id}
            clientId={clientId}
            contact={editing === "new" ? null : editing}
            onDone={(r) => {
              toast.fromState(r);
              setEditing(null);
              router.refresh();
            }}
          />
        ) : null}
      </Dialog>

      <Dialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        size="sm"
        title="Remove contact?"
        footer={
          <>
            <button type="button" className={buttonClass("secondary")} onClick={() => setRemoving(null)}>
              Cancel
            </button>
            <button type="button" disabled={pending} className={buttonClass("danger")} onClick={() => removing && remove(removing)}>
              {pending ? "Removing…" : "Remove"}
            </button>
          </>
        }
      >
        <p className="text-[13px] text-ink">{removing?.name} will be removed from this client’s contacts. The change is recorded in the client’s activity.</p>
      </Dialog>
    </div>
  );
}

function ContactForm({ clientId, contact, onDone }: { clientId: string; contact: ContactView | null; onDone: (r: ActionState) => void }) {
  const [state, action] = useActionState(saveContactAction.bind(null, clientId, contact?.id ?? null), idleState);
  const done = useRef(false);
  useEffect(() => {
    if (state.status === "success" && !done.current) {
      done.current = true;
      onDone(state);
    }
  }, [state, onDone]);
  return (
    <form action={action} className="space-y-3" noValidate>
      <FormMessage state={state.status === "error" ? state : idleState} />
      <TextField name="name" label="Name" required state={state} defaultValue={contact?.name} />
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField name="role" label="Role" state={state} defaultValue={contact?.role ?? "primary"} options={roleOptions} />
        <TextField name="title" label="Job title (optional)" state={state} defaultValue={contact?.title} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField name="email" label="Email" type="email" inputMode="email" autoComplete="off" state={state} defaultValue={contact?.email} />
        <TextField name="phone" label="Phone" type="tel" inputMode="tel" autoComplete="off" state={state} defaultValue={contact?.phone} />
      </div>
      <label className="flex items-center gap-2 text-[13px] text-ink">
        <input type="checkbox" name="isPrimary" defaultChecked={state.values ? state.values.isPrimary === "on" : contact?.isPrimary} className="size-4 accent-brand" />
        Primary contact for this client
      </label>
      <div className="space-y-1.5">
        <label htmlFor="contact-notes" className="block text-[12.5px] font-medium text-ink">
          Notes (optional)
        </label>
        <textarea id="contact-notes" name="notes" rows={2} maxLength={1000} defaultValue={state.values?.notes ?? contact?.notes ?? ""} className={textareaClass} />
      </div>
      <div className="flex justify-end">
        <SubmitButton>{contact ? "Save contact" : "Add contact"}</SubmitButton>
      </div>
    </form>
  );
}

/* ───────── Onboarding checklist ───────── */

export interface OnboardingItemView {
  id: string;
  title: string;
  kind: "information" | "document";
  status: "requested" | "received" | "verified" | "waived";
  receivedAt: string | null;
  verifiedAt: string | null;
}

const ITEM_STATUS: Record<OnboardingItemView["status"], { label: string; tone: "warn" | "info" | "good" | "neutral" }> = {
  requested: { label: "Requested", tone: "warn" },
  received: { label: "Received — needs verification", tone: "info" },
  verified: { label: "Verified", tone: "good" },
  waived: { label: "Waived", tone: "neutral" },
};

export function OnboardingChecklist({
  clientId,
  items,
  status,
  canEdit,
  canApprove,
}: {
  clientId: string;
  items: OnboardingItemView[];
  status: keyof typeof ONBOARDING_STATUS_LABELS;
  canEdit: boolean;
  canApprove: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [formKey, setFormKey] = useState(0);
  const done = items.filter((i) => i.status === "verified" || i.status === "waived").length;

  const set = (itemId: string, next: OnboardingItemView["status"]) =>
    start(async () => {
      toast.fromState(await setOnboardingItemAction(clientId, itemId, next));
      router.refresh();
    });

  return (
    <div id="onboarding" className="scroll-mt-20 rounded-lg border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <h2 className="text-[14px] font-semibold text-ink">Onboarding checklist</h2>
          <p className="text-[12.5px] text-muted">
            {items.length ? `${done} of ${items.length} complete` : "Request the information and documents you need before work starts."}
          </p>
        </div>
        <Badge tone={ONBOARDING_TONE[status]} dot>
          {ONBOARDING_STATUS_LABELS[status]}
        </Badge>
      </div>
      {items.length ? (
        <div className="px-4 pt-3">
          <div className="h-1.5 overflow-hidden rounded-full bg-subtle" role="progressbar" aria-valuemin={0} aria-valuemax={items.length} aria-valuenow={done} aria-label="Onboarding progress">
            <div className="h-full rounded-full bg-success transition-all" style={{ width: `${Math.round((done / items.length) * 100)}%` }} />
          </div>
        </div>
      ) : null}
      {items.length ? (
        <ul className="divide-y divide-line">
          {items.map((i) => {
            const s = ITEM_STATUS[i.status];
            return (
              <li key={i.id} className="flex flex-col gap-2 px-4 py-2.5 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-center gap-2.5">
                  {i.kind === "document" ? <FileText className="size-4 shrink-0 text-muted" aria-hidden /> : <Info className="size-4 shrink-0 text-muted" aria-hidden />}
                  <span className={i.status === "verified" || i.status === "waived" ? "text-[13px] text-muted line-through" : "text-[13px] text-ink"}>{i.title}</span>
                  <span className="sr-only">({i.kind})</span>
                  <Badge tone={s.tone}>{s.label}</Badge>
                </div>
                {canEdit ? (
                  <div className="flex flex-wrap gap-1 sm:shrink-0">
                    {i.status === "requested" ? (
                      <button type="button" disabled={pending} onClick={() => set(i.id, "received")} className={buttonClass("ghost", undefined, "sm")}>
                        <CircleCheck /> Mark received
                      </button>
                    ) : null}
                    {i.status === "received" ? (
                      <button type="button" disabled={pending} onClick={() => set(i.id, "verified")} className={buttonClass("primary", undefined, "sm")}>
                        <ShieldCheck /> Verify
                      </button>
                    ) : null}
                    {canApprove && (i.status === "requested" || i.status === "received") ? (
                      <button type="button" disabled={pending} onClick={() => set(i.id, "waived")} className={buttonClass("ghost", undefined, "sm")}>
                        Waive
                      </button>
                    ) : null}
                    {i.status !== "requested" ? (
                      <button type="button" disabled={pending} onClick={() => set(i.id, "requested")} className={buttonClass("ghost", undefined, "sm")}>
                        <RotateCcw /> Request again
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {canEdit ? (
        <OnboardingItemForm
          key={formKey}
          clientId={clientId}
          onAdded={(r) => {
            toast.fromState(r);
            setFormKey((k) => k + 1);
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function OnboardingItemForm({ clientId, onAdded }: { clientId: string; onAdded: (r: ActionState) => void }) {
  const [state, action] = useActionState(addOnboardingItemAction.bind(null, clientId), idleState);
  const done = useRef(false);
  useEffect(() => {
    if (state.status === "success" && !done.current) {
      done.current = true;
      onAdded(state);
    }
  }, [state, onAdded]);
  return (
    <form action={action} className="flex flex-col gap-2 border-t border-line bg-hover px-4 py-3 sm:flex-row sm:items-end" noValidate>
      <div className="min-w-0 flex-1">
        <TextField name="title" label="Request an item" state={state} placeholder="e.g. 2025 W-2 forms, photo ID, prior-year return" />
      </div>
      <div className="sm:w-40">
        <SelectField
          name="kind"
          label="Type"
          state={state}
          defaultValue="document"
          options={[
            { value: "document", label: "Document" },
            { value: "information", label: "Information" },
          ]}
        />
      </div>
      <SubmitButton pendingText="Adding…" size="sm">
        <Plus /> Request
      </SubmitButton>
    </form>
  );
}
