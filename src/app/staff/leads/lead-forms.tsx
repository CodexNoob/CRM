"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, Pencil, Plus, UserCheck } from "lucide-react";
import { addLeadActivityAction, archiveLeadAction, convertLeadAction, createLeadAction, moveLeadAction, setLeadStatusAction, updateLeadAction } from "@/app/actions/crm";
import type { ClientType, LeadSource, LeadStatus, Priority, ServiceType } from "@/db/schema";
import { Dialog } from "@/components/dialog";
import { FormMessage, inputClass, SelectField, SubmitButton, TextField, textareaClass } from "@/components/form";
import { useToast } from "@/components/toast";
import { Alert, buttonClass, cx } from "@/components/ui";
import { idleState, type ActionState } from "@/lib/action-state";
import { CLIENT_TYPE_LABELS, LEAD_SOURCE_LABELS, LEAD_STATUS_LABELS, PRIORITY_LABELS, SERVICE_LABELS } from "@/lib/labels";
import { MOVABLE_STAGES } from "./filters";

export interface StaffOption {
  id: string;
  name: string;
}

/** Serializable lead data for the client components. */
export interface LeadView {
  id: string;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  clientType: ClientType | null;
  address: string | null;
  requestedServices: ServiceType[];
  source: LeadSource;
  priority: Priority;
  estimatedValueCents: number | null;
  ownerId: string | null;
  followUpDate: string | null;
  message: string | null;
  notes: string | null;
  status: LeadStatus;
}

const sourceOptions = Object.entries(LEAD_SOURCE_LABELS).map(([value, label]) => ({ value, label }));
const priorityOptions = Object.entries(PRIORITY_LABELS).map(([value, label]) => ({ value, label }));
const typeOptions = (["individual", "business", "household"] as const).map((t) => ({ value: t, label: CLIENT_TYPE_LABELS[t] }));

/** Shows the top-of-form message, including form-level errors that come back as fieldErrors._form. */
function FormError({ state }: { state: ActionState }) {
  const s = state.status === "error" && state.fieldErrors?._form ? { ...state, message: state.fieldErrors._form.join(" ") } : state;
  return <FormMessage state={s.status === "success" ? idleState : s} />;
}

function Textarea({ name, label, defaultValue, rows = 3, max, hint, state }: { name: string; label: string; defaultValue?: string | null; rows?: number; max: number; hint?: string; state: ActionState }) {
  const errors = state.fieldErrors?.[name];
  return (
    <div className="space-y-1.5">
      <label htmlFor={name} className="block text-[12.5px] font-medium text-ink">
        {label}
      </label>
      <textarea
        id={name}
        name={name}
        rows={rows}
        maxLength={max}
        defaultValue={state.values?.[name] ?? defaultValue ?? ""}
        aria-invalid={errors ? true : undefined}
        aria-describedby={errors ? `${name}-error` : undefined}
        className={textareaClass}
      />
      {hint && !errors ? <p className="text-[12px] text-muted">{hint}</p> : null}
      {errors ? (
        <p id={`${name}-error`} className="text-[12px] text-danger-ink">
          {errors.join(" ")}
        </p>
      ) : null}
    </div>
  );
}

/** The lead fields shared by "New lead" and "Edit lead". */
function LeadFields({ state, lead, staff, canAssign, meId, withNotes }: { state: ActionState; lead?: LeadView; staff: StaffOption[]; canAssign: boolean; meId: string; withNotes?: boolean }) {
  const selected = new Set<string>(lead?.requestedServices ?? []);
  const servicesError = state.fieldErrors?.requestedServices;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField name="name" label="Contact name" required state={state} defaultValue={lead?.name} autoComplete="off" />
        <TextField name="company" label="Company (if a business)" state={state} defaultValue={lead?.company} />
        <TextField name="email" label="Email" type="email" inputMode="email" state={state} defaultValue={lead?.email} />
        <TextField name="phone" label="Phone" type="tel" inputMode="tel" state={state} defaultValue={lead?.phone} />
        <SelectField name="clientType" label="Client type" state={state} defaultValue={lead?.clientType} options={typeOptions} placeholder="Not sure yet" />
        <SelectField name="source" label="Source" state={state} defaultValue={lead?.source ?? "phone"} options={sourceOptions} />
        <SelectField name="priority" label="Priority" state={state} defaultValue={lead?.priority ?? "normal"} options={priorityOptions} />
        <TextField
          name="estimatedValueCents"
          label="Estimated value (USD)"
          inputMode="text"
          placeholder="1500.00"
          state={state}
          defaultValue={lead?.estimatedValueCents !== null && lead?.estimatedValueCents !== undefined ? (lead.estimatedValueCents / 100).toFixed(2) : undefined}
        />
        {canAssign ? (
          <SelectField name="ownerId" label="Assigned to" state={state} defaultValue={lead ? lead.ownerId : meId} options={staff.map((s) => ({ value: s.id, label: s.name }))} placeholder="Unassigned" />
        ) : lead?.ownerId ? (
          <input type="hidden" name="ownerId" value={lead.ownerId} />
        ) : null}
        <TextField name="followUpDate" label="Next follow-up" type="date" state={state} defaultValue={lead?.followUpDate} />
      </div>
      <TextField name="address" label="Address" state={state} defaultValue={lead?.address} autoComplete="off" />
      <fieldset>
        <legend className="mb-1.5 text-[12.5px] font-medium text-ink">Requested services</legend>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {(Object.keys(SERVICE_LABELS) as ServiceType[]).map((s) => (
            <label key={s} className="flex items-center gap-2 text-[13px] text-ink">
              <input type="checkbox" name="requestedServices" value={s} defaultChecked={selected.has(s)} className="size-4 accent-brand" />
              {SERVICE_LABELS[s]}
            </label>
          ))}
        </div>
        {servicesError ? <p className="mt-1 text-[12px] text-danger-ink">{servicesError.join(" ")}</p> : null}
      </fieldset>
      {lead ? (
        // The prospect's own message (website) is kept as-is.
        <input type="hidden" name="message" value={lead.message ?? ""} />
      ) : (
        <Textarea name="message" label="What do they need? (optional)" max={2000} state={state} hint="Don’t record Social Security or account numbers." />
      )}
      {withNotes ? <Textarea name="notes" label="Internal notes" max={5000} rows={4} defaultValue={lead?.notes} state={state} hint="Visible to staff only." /> : null}
    </div>
  );
}

export function NewLeadButton({ staff, canAssign, meId }: { staff: StaffOption[]; canAssign: boolean; meId: string }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(0);
  return (
    <>
      <button type="button" onClick={() => (setKey((k) => k + 1), setOpen(true))} className={buttonClass("primary")}>
        <Plus /> New lead
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="New lead" description="A prospect you may work with. It becomes a client only when you convert it." size="lg">
        <NewLeadForm key={key} staff={staff} canAssign={canAssign} meId={meId} />
      </Dialog>
    </>
  );
}

function NewLeadForm({ staff, canAssign, meId }: { staff: StaffOption[]; canAssign: boolean; meId: string }) {
  // Redirects to the new lead on success.
  const [state, action] = useActionState(createLeadAction, idleState);
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormError state={state} />
      <LeadFields state={state} staff={staff} canAssign={canAssign} meId={meId} />
      <div className="flex justify-end border-t border-line pt-3">
        <SubmitButton pendingText="Adding…">Add lead</SubmitButton>
      </div>
    </form>
  );
}

export function EditLeadButton({ lead, staff, canAssign, meId }: { lead: LeadView; staff: StaffOption[]; canAssign: boolean; meId: string }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(0);
  return (
    <>
      <button type="button" onClick={() => (setKey((k) => k + 1), setOpen(true))} className={buttonClass("secondary")}>
        <Pencil /> Edit
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Edit lead" size="lg">
        <EditLeadForm key={key} lead={lead} staff={staff} canAssign={canAssign} meId={meId} onDone={() => setOpen(false)} />
      </Dialog>
    </>
  );
}

function EditLeadForm({ lead, staff, canAssign, meId, onDone }: { lead: LeadView; staff: StaffOption[]; canAssign: boolean; meId: string; onDone: () => void }) {
  const [state, action] = useActionState(updateLeadAction.bind(null, lead.id), idleState);
  const toast = useToast();
  const router = useRouter();
  useEffect(() => {
    if (state.status === "success") {
      toast.fromState(state);
      router.refresh();
      onDone();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormError state={state} />
      <LeadFields state={state} lead={lead} staff={staff} canAssign={canAssign} meId={meId} withNotes />
      <div className="flex justify-end gap-2 border-t border-line pt-3">
        <button type="button" onClick={onDone} className={buttonClass("ghost")}>
          Cancel
        </button>
        <SubmitButton>Save lead</SubmitButton>
      </div>
    </form>
  );
}

/** Small dialog asking why a lead (or several) was lost. */
export function LostReasonDialog({ open, count = 1, onClose, onConfirm }: { open: boolean; count?: number; onClose: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState(false);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      title={count > 1 ? `Mark ${count} leads as lost` : "Mark lead as lost"}
      footer={
        <>
          <button type="button" onClick={onClose} className={buttonClass("ghost")}>
            Cancel
          </button>
          <button
            type="button"
            className={buttonClass("danger")}
            onClick={() => {
              if (!reason.trim()) return setError(true);
              onConfirm(reason.trim());
              setReason("");
            }}
          >
            Mark lost
          </button>
        </>
      }
    >
      <label htmlFor="lost-reason" className="block text-[12.5px] font-medium text-ink">
        Reason
      </label>
      <input
        id="lost-reason"
        value={reason}
        maxLength={500}
        onChange={(e) => (setReason(e.target.value), setError(false))}
        placeholder="Chose another firm, price, no response…"
        aria-invalid={error || undefined}
        aria-describedby={error ? "lost-reason-error" : undefined}
        className={cx(inputClass, "mt-1.5")}
      />
      {error ? (
        <p id="lost-reason-error" className="mt-1 text-[12px] text-danger-ink">
          Say why the lead was lost.
        </p>
      ) : null}
    </Dialog>
  );
}

/**
 * Stage moves from row menus and kanban cards: moves directly, except "Lost", which asks
 * for a reason first. Returns `move(id, stage)` and the dialog element to render.
 */
export function useLeadMover(): { move: (id: string, stage: LeadStatus) => void; dialog: ReactNode; pending: boolean } {
  const toast = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [lostFor, setLostFor] = useState<string | null>(null);
  const run = (id: string, stage: string, reason?: string) =>
    start(async () => {
      toast.fromState(await moveLeadAction(id, stage, reason));
      router.refresh();
    });
  return {
    pending,
    move: (id, stage) => (stage === "lost" ? setLostFor(id) : run(id, stage)),
    dialog: (
      <LostReasonDialog
        open={!!lostFor}
        onClose={() => setLostFor(null)}
        onConfirm={(reason) => {
          if (lostFor) run(lostFor, "lost", reason);
          setLostFor(null);
        }}
      />
    ),
  };
}

/** Stage picker on the lead page (records an optional note; Lost requires a reason). */
export function StageControl({ id, status }: { id: string; status: LeadStatus }) {
  const [state, action] = useActionState(setLeadStatusAction.bind(null, id), idleState);
  const [stage, setStage] = useState<string>(status === "converted" ? "new" : status);
  const toast = useToast();
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.status === "success") {
      toast.fromState(state);
      formRef.current?.reset();
      router.refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  // The page renders this with key={status}, so a new stage remounts it with fresh state.
  return (
    <form ref={formRef} action={action} className="space-y-3" noValidate>
      <FormError state={state} />
      <div className="space-y-1.5">
        <label htmlFor="stage" className="block text-[12.5px] font-medium text-ink">
          Stage
        </label>
        <select id="stage" name="status" value={stage} onChange={(e) => setStage(e.target.value)} className={cx(inputClass, "pr-7")}>
          {MOVABLE_STAGES.map((s) => (
            <option key={s} value={s}>
              {LEAD_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </div>
      {stage === "lost" ? <TextField name="lostReason" label="Why was it lost?" required state={state} /> : <TextField name="note" label="Note (optional)" state={state} />}
      <SubmitButton variant="secondary" pendingText="Updating…" className="w-full">
        Update stage
      </SubmitButton>
      <p className="text-[12px] text-muted">To mark it Won, use “Convert to client”.</p>
    </form>
  );
}

/** Log a note, call, email or meeting (and optionally schedule the next follow-up). */
export function LogActivityForm({ id }: { id: string }) {
  const [formKey, setFormKey] = useState(0);
  return <LogActivityFormBody key={formKey} id={id} onDone={() => setFormKey((k) => k + 1)} />;
}

function LogActivityFormBody({ id, onDone }: { id: string; onDone: () => void }) {
  const [state, action] = useActionState(addLeadActivityAction.bind(null, id), idleState);
  const toast = useToast();
  const router = useRouter();
  useEffect(() => {
    if (state.status === "success") {
      toast.fromState(state);
      router.refresh();
      onDone();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  return (
    <form action={action} className="space-y-3" noValidate>
      <FormError state={state} />
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
        <SelectField
          name="type"
          label="Type"
          state={state}
          defaultValue="note"
          options={[
            { value: "note", label: "Note" },
            { value: "call", label: "Call" },
            { value: "email", label: "Email" },
            { value: "meeting", label: "Meeting" },
          ]}
        />
        <TextField name="occurredAt" label="When (optional)" type="datetime-local" state={state} hint="Leave blank for now." />
      </div>
      <Textarea name="body" label="Details" max={5000} state={state} hint="What was discussed? Don’t record tax identifiers." />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="sm:w-48">
          <TextField name="followUpDate" label="Next follow-up (optional)" type="date" state={state} />
        </div>
        <SubmitButton pendingText="Saving…">Log activity</SubmitButton>
      </div>
    </form>
  );
}

export function ArchiveLeadButton({ id, archived }: { id: string; archived: boolean }) {
  const toast = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      className={buttonClass("ghost", archived ? undefined : "text-danger-ink")}
      onClick={() => {
        if (!archived && !window.confirm("Archive this lead? It will be hidden from lists. Its history is kept and you can restore it.")) return;
        start(async () => {
          const r = await archiveLeadAction(id, !archived);
          toast.fromState(r);
          if (r.status === "success") router.push(archived ? `/staff/leads/${id}` : "/staff/leads");
          router.refresh();
        });
      }}
    >
      {archived ? <ArchiveRestore /> : <Archive />} {archived ? "Restore" : "Archive"}
    </button>
  );
}

/* ───────── Convert to client ───────── */

export interface DuplicateView {
  id: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  number: string | null;
  reasons: ("email" | "phone" | "name")[];
}

const REASON_LABEL = { email: "same email", phone: "same phone", name: "same name" } as const;

export function ConvertLeadButton({
  lead,
  duplicates,
  clients,
  staff,
  canAssign,
}: {
  lead: LeadView;
  duplicates: DuplicateView[];
  clients: { id: string; name: string }[];
  staff: StaffOption[];
  canAssign: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(0);
  return (
    <>
      <button type="button" onClick={() => (setKey((k) => k + 1), setOpen(true))} className={buttonClass("primary")}>
        <UserCheck /> Convert to client
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Convert to client" description="Review the details. The lead is kept with its history and marked Won / Converted." size="lg">
        <ConvertForm key={key} lead={lead} duplicates={duplicates} clients={clients} staff={staff} canAssign={canAssign} onCancel={() => setOpen(false)} />
      </Dialog>
    </>
  );
}

function ConvertForm({
  lead,
  duplicates,
  clients,
  staff,
  canAssign,
  onCancel,
}: {
  lead: LeadView;
  duplicates: DuplicateView[];
  clients: { id: string; name: string }[];
  staff: StaffOption[];
  canAssign: boolean;
  onCancel: () => void;
}) {
  const [state, action] = useActionState(convertLeadAction.bind(null, lead.id), idleState);
  const [mode, setMode] = useState<"new" | "existing">(duplicates.length ? "existing" : "new");
  const [type, setType] = useState<string>(lead.clientType ?? (lead.company ? "business" : "individual"));
  const alreadyClient = state.status === "error" ? state.data?.clientId : undefined;
  const nameParts = lead.name.trim().split(/\s+/);
  const v = (k: string, fallback: string | null | undefined) => state.values?.[k] ?? fallback ?? "";

  if (alreadyClient) {
    return (
      <div className="space-y-3">
        <Alert tone="info">This lead was already converted.</Alert>
        <Link href={`/staff/clients/${alreadyClient}`} className={buttonClass("primary")}>
          Open the client record
        </Link>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4" noValidate>
      <FormError state={state} />
      <input type="hidden" name="mode" value={mode} />

      <fieldset className="grid gap-2 sm:grid-cols-2">
        <legend className="sr-only">How to convert</legend>
        {(
          [
            ["new", "Create a new client", "Add a new client record from this lead."],
            ["existing", "Link to an existing client", "The prospect is already a client — don’t create a duplicate."],
          ] as const
        ).map(([m, title, body]) => (
          <label key={m} className={cx("flex cursor-pointer gap-2.5 rounded-lg border p-3 text-[13px]", mode === m ? "border-brand bg-brand-soft/40" : "border-line")}>
            <input type="radio" name="_mode" value={m} checked={mode === m} onChange={() => setMode(m)} className="mt-0.5 size-4 accent-brand" />
            <span>
              <span className="block font-medium text-ink">{title}</span>
              <span className="block text-muted">{body}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {duplicates.length ? (
        <Alert tone="warning" title="Possible existing clients">
          <ul className="mt-1 space-y-0.5">
            {duplicates.map((d) => (
              <li key={d.id}>
                <Link href={`/staff/clients/${d.id}`} target="_blank" className="font-medium underline underline-offset-2">
                  {d.number ? `${d.number} · ` : ""}
                  {d.displayName}
                </Link>{" "}
                <span className="text-[12px]">({d.reasons.map((r) => REASON_LABEL[r]).join(", ")})</span>
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}

      {mode === "existing" ? (
        <div className="space-y-1.5">
          <label htmlFor="clientId" className="block text-[12.5px] font-medium text-ink">
            Client
          </label>
          <select id="clientId" name="clientId" defaultValue={v("clientId", duplicates[0]?.id)} className={cx(inputClass, "pr-7")} aria-invalid={state.fieldErrors?.clientId ? true : undefined}>
            <option value="">Choose a client…</option>
            {duplicates.length ? (
              <optgroup label="Possible matches">
                {duplicates.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.displayName}
                  </option>
                ))}
              </optgroup>
            ) : null}
            <optgroup label="All clients">
              {clients
                .filter((c) => !duplicates.some((d) => d.id === c.id))
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </optgroup>
          </select>
          {state.fieldErrors?.clientId ? <p className="text-[12px] text-danger-ink">{state.fieldErrors.clientId.join(" ")}</p> : null}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="type" className="block text-[12.5px] font-medium text-ink">
                Client type
              </label>
              <select id="type" name="type" value={type} onChange={(e) => setType(e.target.value)} className={cx(inputClass, "pr-7")}>
                {typeOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <TextField name="displayName" label={type === "business" ? "Business name" : "Client name"} required state={state} defaultValue={v("displayName", lead.company || lead.name)} />
            {type !== "business" ? (
              <>
                <TextField name="firstName" label="First name" state={state} defaultValue={v("firstName", nameParts.length > 1 ? nameParts.slice(0, -1).join(" ") : lead.name)} />
                <TextField name="lastName" label="Last name" state={state} defaultValue={v("lastName", nameParts.length > 1 ? nameParts.at(-1) : "")} />
              </>
            ) : null}
            <TextField name="email" label="Email" type="email" state={state} defaultValue={v("email", lead.email)} />
            <TextField name="phone" label="Phone" type="tel" state={state} defaultValue={v("phone", lead.phone)} />
            {canAssign ? (
              <SelectField name="accountManagerId" label="Account manager" state={state} defaultValue={lead.ownerId} options={staff.map((s) => ({ value: s.id, label: s.name }))} placeholder="Unassigned" />
            ) : null}
          </div>
          <TextField name="address" label="Address" state={state} defaultValue={v("address", lead.address)} />
          {duplicates.length ? (
            <label className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning-soft p-2.5 text-[13px] text-ink">
              <input type="checkbox" name="confirmNotDuplicate" className="mt-0.5 size-4 accent-brand" />
              <span>This is a different client from the possible matches above — create a new record.</span>
            </label>
          ) : null}
          <p className="text-[12px] text-muted">The new client starts in onboarding. No engagement is created — you can add one next.</p>
        </div>
      )}

      <div className="flex justify-end gap-2 border-t border-line pt-3">
        <button type="button" onClick={onCancel} className={buttonClass("ghost")}>
          Cancel
        </button>
        <SubmitButton pendingText="Converting…">{mode === "existing" ? "Link and convert" : "Create client and convert"}</SubmitButton>
      </div>
    </form>
  );
}
