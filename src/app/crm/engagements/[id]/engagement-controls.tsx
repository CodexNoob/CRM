"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ListPlus, Pencil, Plus, Users, Wand2 } from "lucide-react";
import {
  createEngagementTaskAction,
  generateWorkflowAction,
  overrideWorkStartAction,
  previewWorkflowAction,
  setEngagementStatusAction,
  setEngagementTaskStatusAction,
  setEngagementTeamAction,
  setProposalAction,
  updateEngagementAction,
  type PreviewResult,
} from "@/app/actions/engagements";
import type { EngagementStatus, TaskStatus } from "@/db/schema";
import { Dialog } from "@/components/dialog";
import { FormMessage, inputClass, SelectField, SubmitButton, textareaClass, TextField } from "@/components/form";
import { Menu } from "@/components/menu";
import { useToast } from "@/components/toast";
import { Alert, buttonClass, cx } from "@/components/ui";
import { idleState, type ActionState } from "@/lib/action-state";
import { PRIORITY_LABELS, ROLE_LABELS, TASK_STATUS_LABELS } from "@/lib/labels";
import { EngagementForm, type EngagementFormValues } from "../../engagement-form";
import { moveItems } from "../engagement-views";

type Staff = { id: string; name: string; role: keyof typeof ROLE_LABELS };

function useRun() {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<ActionState>, after?: (s: ActionState) => void) =>
    start(async () => {
      const s = await fn();
      toast.fromState(s);
      after?.(s);
      router.refresh();
    });
  return { run, pending };
}

/* ───────── Header controls ───────── */

export function StatusMenu({ id, status, canApprove }: { id: string; status: EngagementStatus; canApprove: boolean }) {
  const { run, pending } = useRun();
  return (
    <Menu
      label="Change status"
      triggerClassName={buttonClass("secondary")}
      trigger={
        <>
          {pending ? "Updating…" : "Change status"} <ChevronDown aria-hidden />
        </>
      }
      items={moveItems(status, canApprove, (s) => {
        if ((s === "cancelled" || s === "closed") && !window.confirm(s === "closed" ? "Close this engagement? Closed engagements can’t be reopened." : "Cancel this engagement?")) return;
        run(() => setEngagementStatusAction(id, s));
      })}
    />
  );
}

export function CloseEngagementButton({ id }: { id: string }) {
  const { run, pending } = useRun();
  return (
    <button
      type="button"
      disabled={pending}
      className={buttonClass("primary")}
      onClick={() => {
        if (window.confirm("Close this engagement? Its history is kept, but it can’t be reopened or changed.")) run(() => setEngagementStatusAction(id, "closed", "Engagement closed"));
      }}
    >
      {pending ? "Closing…" : "Close engagement"}
    </button>
  );
}

export function MoveToReviewButton({ id }: { id: string }) {
  const { run, pending } = useRun();
  return (
    <button type="button" disabled={pending} className={buttonClass("primary", undefined, "sm")} onClick={() => run(() => setEngagementStatusAction(id, "in_review", "All tasks completed"))}>
      {pending ? "Moving…" : "Move to Under review"}
    </button>
  );
}

export function EditEngagementButton({ id, staff, initial, canAssign, actorId }: { id: string; staff: Staff[]; initial: Partial<EngagementFormValues>; canAssign: boolean; actorId: string }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const toast = useToast();
  const action = async (prev: ActionState, fd: FormData) => {
    const s = await updateEngagementAction(id, prev, fd);
    if (s.status === "success") {
      toast.fromState(s);
      setOpen(false);
      router.refresh();
    }
    return s;
  };
  return (
    <>
      <button type="button" className={buttonClass("secondary")} onClick={() => setOpen(true)}>
        <Pencil /> Edit
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Edit engagement" size="lg">
        <EngagementForm action={action} staff={staff} initial={initial} submitLabel="Save changes" mode="edit" canAssign={canAssign} actorId={actorId} />
      </Dialog>
    </>
  );
}

/* ───────── Proposal ───────── */

export function ProposalControls({ id, proposal, canApprove, canEdit }: { id: string; proposal: "not_required" | "draft" | "sent" | "accepted" | "declined"; canApprove: boolean; canEdit: boolean }) {
  const { run, pending } = useRun();
  const [acceptedOn, setAcceptedOn] = useState(() => new Date().toISOString().slice(0, 10));
  if (proposal === "not_required" || proposal === "accepted" || !canEdit) return null;
  return (
    <div className="space-y-3">
      {proposal === "draft" ? (
        <button type="button" disabled={pending} className={buttonClass("secondary", undefined, "sm")} onClick={() => run(() => setProposalAction(id, "sent"))}>
          Mark proposal sent
        </button>
      ) : null}
      {canApprove && proposal !== "declined" ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="space-y-1">
            <span className="block text-[12px] font-medium text-muted">Accepted on</span>
            <input type="date" value={acceptedOn} onChange={(e) => setAcceptedOn(e.target.value)} className={inputClass + " w-40"} />
          </label>
          <button type="button" disabled={pending} className={buttonClass("primary", undefined, "sm")} onClick={() => run(() => setProposalAction(id, "accepted", acceptedOn))}>
            Record acceptance
          </button>
          <button
            type="button"
            disabled={pending}
            className={buttonClass("ghost", "text-danger-ink", "sm")}
            onClick={() => {
              if (window.confirm("Mark the proposal declined? The engagement will be cancelled.")) run(() => setProposalAction(id, "declined"));
            }}
          >
            Declined
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function OverrideWorkForm({ id }: { id: string }) {
  const router = useRouter();
  const toast = useToast();
  const [state, action] = useActionState(async (prev: ActionState, fd: FormData) => {
    const s = await overrideWorkStartAction(id, prev, fd);
    if (s.status === "success") {
      toast.fromState(s);
      router.refresh();
    }
    return s;
  }, idleState);
  return (
    <form action={action} className="space-y-2 border-t border-line pt-3" noValidate>
      <p className="text-[12.5px] font-medium text-ink">Allow work to start before acceptance</p>
      <TextField name="reason" label="Reason" required state={state} placeholder="e.g. Client approved by phone; signed letter to follow" />
      <SubmitButton variant="secondary" size="sm" pendingText="Saving…">Allow work to start</SubmitButton>
    </form>
  );
}

/* ───────── Tasks ───────── */

const TASK_MOVES: TaskStatus[] = ["todo", "in_progress", "waiting_client", "waiting_review", "blocked", "completed", "cancelled"];

export function TaskStatusMenu({ engagementId, taskId, title, status }: { engagementId: string; taskId: string; title: string; status: TaskStatus }) {
  const { run, pending } = useRun();
  return (
    <Menu
      label={`Change status of ${title}`}
      triggerClassName="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12px] text-muted hover:bg-subtle hover:text-ink"
      trigger={
        <>
          {pending ? "…" : "Status"} <ChevronDown className="size-3" aria-hidden />
        </>
      }
      items={TASK_MOVES.filter((s) => s !== status).map((s) => ({ label: TASK_STATUS_LABELS[s], onSelect: () => run(() => setEngagementTaskStatusAction(engagementId, taskId, s)) }))}
    />
  );
}

export function AddTaskButton({ engagementId, staff, tasks, canAssign, actorId }: { engagementId: string; staff: Staff[]; tasks: { id: string; title: string }[]; canAssign: boolean; actorId: string }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(0);
  const router = useRouter();
  const toast = useToast();
  const [state, action] = useActionState(async (prev: ActionState, fd: FormData) => {
    const s = await createEngagementTaskAction(engagementId, prev, fd);
    if (s.status === "success") {
      toast.fromState(s);
      setOpen(false);
      setKey((k) => k + 1);
      router.refresh();
    }
    return s;
  }, idleState);
  const assignable = canAssign ? staff : staff.filter((s) => s.id === actorId);
  return (
    <>
      <button type="button" className={buttonClass("secondary", undefined, "sm")} onClick={() => setOpen(true)}>
        <Plus /> Add task
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Add task" description="The task belongs to this engagement and its client.">
        <form key={key} action={action} className="space-y-4" noValidate>
          <FormMessage state={state} />
          <TextField name="title" label="Task" required state={state} />
          <div className="space-y-1.5">
            <label htmlFor="task-description" className="block text-[12.5px] font-medium text-ink">Description</label>
            <textarea id="task-description" name="description" rows={2} maxLength={5000} defaultValue={state.values?.description} className={textareaClass} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField name="assigneeId" label="Assignee" state={state} placeholder="Unassigned" options={assignable.map((s) => ({ value: s.id, label: s.name }))} />
            <SelectField name="priority" label="Priority" state={state} defaultValue="normal" options={Object.entries(PRIORITY_LABELS).map(([value, label]) => ({ value, label }))} />
            <TextField name="startDate" label="Start date" type="date" state={state} />
            <TextField name="dueDate" label="Due date" type="date" state={state} />
          </div>
          {tasks.length ? (
            <fieldset>
              <legend className="mb-1 text-[12.5px] font-medium text-ink">Can’t start until these are done</legend>
              <div className="max-h-36 space-y-1 overflow-y-auto rounded-md border border-line p-2">
                {tasks.map((t) => (
                  <label key={t.id} className="flex items-center gap-2 text-[13px]">
                    <input type="checkbox" name="dependsOn" value={t.id} className="size-4 accent-brand" /> {t.title}
                  </label>
                ))}
              </div>
              {state.fieldErrors?.dependsOn ? <p className="mt-1 text-[12px] text-danger-ink">{state.fieldErrors.dependsOn.join(" ")}</p> : null}
            </fieldset>
          ) : null}
          <label className="flex items-start gap-2 text-[13px]">
            <input type="checkbox" name="isClientTask" className="mt-0.5 size-4 accent-brand" />
            <span>
              Client request: show it in the client’s portal so they can complete it.
              <span className="block text-[12px] text-muted">Client requests aren’t assigned to staff.</span>
            </span>
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" className={buttonClass("ghost")} onClick={() => setOpen(false)}>Cancel</button>
            <SubmitButton pendingText="Adding…">Add task</SubmitButton>
          </div>
        </form>
      </Dialog>
    </>
  );
}

type Planned = Extract<PreviewResult, { status: "ok" }>["planned"][number];

export function GenerateWorkflowButton({
  engagementId,
  templates,
  defaultTemplateId,
  staff,
  generatedTemplateIds,
}: {
  engagementId: string;
  templates: { id: string; name: string; steps: number }[];
  defaultTemplateId: string | null;
  staff: Staff[];
  generatedTemplateIds: string[];
}) {
  const [open, setOpen] = useState(false);
  const [templateId, setTemplateId] = useState(defaultTemplateId ?? templates[0]?.id ?? "");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [rows, setRows] = useState<(Planned & { skip: boolean })[]>([]);
  const [loading, startLoad] = useTransition();
  const [saving, startSave] = useTransition();
  const [done, setDone] = useState(false);
  const router = useRouter();
  const toast = useToast();

  useEffect(() => {
    if (!open || !templateId) return;
    startLoad(async () => {
      const p = await previewWorkflowAction(engagementId, templateId);
      setPreview(p);
      setRows(p.status === "ok" ? p.planned.map((x) => ({ ...x, skip: false })) : []);
    });
  }, [open, templateId, engagementId]);

  const already = preview?.status === "ok" && preview.alreadyGenerated;
  const update = (seq: number, patch: Partial<Planned & { skip: boolean }>) => setRows((r) => r.map((x) => (x.sequence === seq ? { ...x, ...patch } : x)));
  const confirm = () =>
    startSave(async () => {
      const s = await generateWorkflowAction(
        engagementId,
        templateId,
        rows.map((r) => ({ sequence: r.sequence, assigneeId: r.assigneeId ?? "", dueDate: r.dueDate ?? "", skip: r.skip })),
      );
      toast.fromState(s);
      if (s.status === "success") {
        setDone(true);
        setOpen(false);
      }
      router.refresh();
    });

  if (!templates.length) return null;
  return (
    <>
      <button type="button" className={buttonClass("primary", undefined, "sm")} onClick={() => { setDone(false); setOpen(true); }}>
        <Wand2 /> Generate from template
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Generate tasks from a workflow template"
        description="Review the tasks before they’re created. You can change assignees and due dates, or skip steps."
        size="lg"
        footer={
          <>
            <button type="button" className={buttonClass("ghost")} onClick={() => setOpen(false)}>Cancel</button>
            <button type="button" className={buttonClass("primary")} disabled={saving || loading || already || done || !rows.some((r) => !r.skip)} onClick={confirm}>
              <ListPlus /> {saving ? "Creating tasks…" : `Create ${rows.filter((r) => !r.skip).length} tasks`}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <label className="block space-y-1">
            <span className="block text-[12.5px] font-medium text-ink">Template</span>
            <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className={inputClass}>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.steps} steps){generatedTemplateIds.includes(t.id) ? " — already generated" : ""}
                </option>
              ))}
            </select>
          </label>
          {loading ? <p className="text-[13px] text-muted">Loading the template…</p> : null}
          {preview?.status === "error" ? <Alert tone="error">{preview.message}</Alert> : null}
          {already ? <Alert tone="info">These tasks were already generated for this engagement, so nothing will be created twice.</Alert> : null}
          {preview?.status === "ok" && !already && !loading ? (
            <div className="overflow-x-auto rounded-md border border-line">
              <table className="w-full text-left text-[13px]">
                <thead className="bg-hover text-[12px] text-muted">
                  <tr>
                    <th scope="col" className="px-3 py-2">#</th>
                    <th scope="col" className="px-3 py-2">Task</th>
                    <th scope="col" className="px-3 py-2">Assignee</th>
                    <th scope="col" className="px-3 py-2">Due</th>
                    <th scope="col" className="px-3 py-2">Skip</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((r) => (
                    <tr key={r.sequence} className={cx(r.skip && "opacity-50")}>
                      <td className="px-3 py-1.5 tabular text-muted">{r.sequence}</td>
                      <td className="px-3 py-1.5">
                        <div className="font-medium text-ink">{r.title}</div>
                        {r.dependsOnSequence ? <div className="text-[12px] text-muted">After step {r.dependsOnSequence}</div> : null}
                      </td>
                      <td className="px-3 py-1.5">
                        {r.isClientTask ? (
                          <span className="text-[12px] text-muted">Client request</span>
                        ) : (
                          <select aria-label={`Assignee for ${r.title}`} value={r.assigneeId ?? ""} onChange={(e) => update(r.sequence, { assigneeId: e.target.value || null })} className={inputClass + " min-w-36"} disabled={r.skip}>
                            <option value="">Unassigned</option>
                            {staff.map((s) => (
                              <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td className="px-3 py-1.5">
                        <input type="date" aria-label={`Due date for ${r.title}`} value={r.dueDate ?? ""} onChange={(e) => update(r.sequence, { dueDate: e.target.value || null })} className={inputClass + " w-36"} disabled={r.skip} />
                      </td>
                      <td className="px-3 py-1.5">
                        <input type="checkbox" aria-label={`Skip ${r.title}`} checked={r.skip} onChange={(e) => update(r.sequence, { skip: e.target.checked })} className="size-4 accent-brand" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      </Dialog>
    </>
  );
}

/* ───────── Team ───────── */

export function EditTeamButton({ engagementId, ownerId, staff, team }: { engagementId: string; ownerId: string; staff: Staff[]; team: { userId: string; role: "manager" | "staff" | "reviewer" }[] }) {
  const [open, setOpen] = useState(false);
  const initial = () => Object.fromEntries(team.filter((m) => m.userId !== ownerId).map((m) => [m.userId, m.role])) as Record<string, "staff" | "reviewer" | "manager">;
  const [sel, setSel] = useState(initial);
  const { run, pending } = useRun();
  return (
    <>
      <button type="button" className={buttonClass("secondary", undefined, "sm")} onClick={() => { setSel(initial()); setOpen(true); }}>
        <Users /> Edit team
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Engagement team"
        description="Team members get access to the client and are notified. The engagement manager is always on the team."
        footer={
          <>
            <button type="button" className={buttonClass("ghost")} onClick={() => setOpen(false)}>Cancel</button>
            <button
              type="button"
              disabled={pending}
              className={buttonClass("primary")}
              onClick={() =>
                run(
                  () => setEngagementTeamAction(engagementId, Object.entries(sel).map(([userId, role]) => ({ userId, role }))),
                  (s) => s.status === "success" && setOpen(false),
                )
              }
            >
              {pending ? "Saving…" : "Save team"}
            </button>
          </>
        }
      >
        <ul className="divide-y divide-line rounded-md border border-line">
          {staff.map((s) => {
            const isOwner = s.id === ownerId;
            const role = sel[s.id];
            return (
              <li key={s.id} className="flex items-center gap-3 px-3 py-2 text-[13px]">
                <input
                  type="checkbox"
                  aria-label={`Include ${s.name}`}
                  checked={isOwner || !!role}
                  disabled={isOwner}
                  onChange={(e) => setSel((x) => { const n = { ...x }; if (e.target.checked) n[s.id] = "staff"; else delete n[s.id]; return n; })}
                  className="size-4 accent-brand"
                />
                <span className="min-w-0 flex-1">
                  {s.name} <span className="text-[12px] text-muted">{ROLE_LABELS[s.role]}</span>
                </span>
                {isOwner ? (
                  <span className="text-[12px] text-muted">Engagement manager</span>
                ) : role ? (
                  <select aria-label={`Role for ${s.name}`} value={role} onChange={(e) => setSel((x) => ({ ...x, [s.id]: e.target.value as "staff" | "reviewer" }))} className={inputClass + " w-32"}>
                    <option value="staff">Staff</option>
                    <option value="reviewer">Reviewer</option>
                  </select>
                ) : null}
              </li>
            );
          })}
        </ul>
      </Dialog>
    </>
  );
}
