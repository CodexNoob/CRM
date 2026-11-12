"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { saveTemplateAction, setTemplateActiveAction } from "@/app/actions/tasks";
import { FormMessage, inputClass, SelectField, SubmitButton, TextField, textareaClass } from "@/components/form";
import { useToast } from "@/components/toast";
import { Alert, buttonClass, cx } from "@/components/ui";
import type { Priority, ServiceType } from "@/db/schema";
import { idleState } from "@/lib/action-state";
import { PRIORITY_LABELS, SERVICE_LABELS } from "@/lib/labels";
import { PRIORITIES } from "../filters";

type Role = "manager" | "staff" | "reviewer" | "unassigned";
const ROLE_LABELS: Record<Role, string> = { manager: "Engagement manager", staff: "Engagement staff", reviewer: "Reviewer", unassigned: "Unassigned" };

export interface StepDraft {
  key: number;
  title: string;
  description: string;
  defaultPriority: Priority;
  relativeDueDays: string;
  defaultAssignee: Role;
  /** Stable key of the step this one depends on (resolved to a sequence on save). */
  dependsOnKey: number | null;
  isClientTask: boolean;
}

let nextKey = 1;
const blankStep = (): StepDraft => ({ key: nextKey++, title: "", description: "", defaultPriority: "normal", relativeDueDays: "", defaultAssignee: "staff", dependsOnKey: null, isClientTask: false });

/**
 * Create / edit a workflow template: name, service, active, and an ordered list of steps.
 * Steps can be reordered; "depends on" follows the step even when it moves (it must stay earlier).
 */
export function TemplateEditor({
  templateId,
  initial,
}: {
  templateId: string | null;
  initial?: { name: string; description: string | null; serviceType: ServiceType; isActive: boolean; steps: { title: string; description: string | null; defaultPriority: Priority; relativeDueDays: number | null; defaultAssignee: Role; dependsOnSequence: number | null; isClientTask: boolean }[] };
}) {
  const [state, action] = useActionState(saveTemplateAction.bind(null, templateId), idleState);
  const toast = useToast();
  const router = useRouter();
  const [steps, setSteps] = useState<StepDraft[]>(() => {
    if (!initial?.steps.length) return [blankStep()];
    const drafts = initial.steps.map((s) => ({ ...blankStep(), title: s.title, description: s.description ?? "", defaultPriority: s.defaultPriority, relativeDueDays: s.relativeDueDays === null ? "" : String(s.relativeDueDays), defaultAssignee: s.defaultAssignee, isClientTask: s.isClientTask }));
    initial.steps.forEach((s, i) => {
      if (s.dependsOnSequence) drafts[i]!.dependsOnKey = drafts[s.dependsOnSequence - 1]?.key ?? null;
    });
    return drafts;
  });

  useEffect(() => {
    if (state.status === "success") {
      toast.fromState(state);
      router.refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const update = (key: number, patch: Partial<StepDraft>) => setSteps((list) => list.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  const move = (i: number, delta: number) =>
    setSteps((list) => {
      const j = i + delta;
      if (j < 0 || j >= list.length) return list;
      const next = [...list];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  const remove = (key: number) => setSteps((list) => list.filter((s) => s.key !== key).map((s) => (s.dependsOnKey === key ? { ...s, dependsOnKey: null } : s)));

  // A dependency is only valid on an earlier step; one that moved later is flagged (and dropped on save).
  const indexOf = new Map(steps.map((s, i) => [s.key, i]));
  const payload = steps.map((s, i) => {
    const depIndex = s.dependsOnKey !== null ? indexOf.get(s.dependsOnKey) : undefined;
    return {
      title: s.title,
      description: s.description,
      defaultPriority: s.defaultPriority,
      relativeDueDays: s.relativeDueDays,
      defaultAssignee: s.defaultAssignee,
      dependsOnSequence: depIndex !== undefined && depIndex < i ? String(depIndex + 1) : "",
      isClientTask: s.isClientTask,
    };
  });
  const stepErrors = state.fieldErrors?.steps ?? Object.entries(state.fieldErrors ?? {}).filter(([k]) => k.startsWith("steps")).flatMap(([, v]) => v);

  return (
    <form action={action} className="space-y-5" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="steps" value={JSON.stringify(payload)} />
      <div className="grid gap-3 rounded-lg border border-line bg-surface p-4 sm:grid-cols-2">
        <TextField name="name" label="Template name" required state={state} defaultValue={initial?.name} />
        <SelectField name="serviceType" label="Service" required state={state} defaultValue={initial?.serviceType ?? "individual_tax"} options={Object.entries(SERVICE_LABELS).map(([value, label]) => ({ value, label }))} />
        <div className="space-y-1.5 sm:col-span-2">
          <label htmlFor="description" className="block text-[12.5px] font-medium text-ink">
            Description
          </label>
          <textarea id="description" name="description" rows={2} maxLength={1000} defaultValue={state.values?.description ?? initial?.description ?? ""} className={textareaClass} />
        </div>
        <label className="flex items-center gap-2 text-[13px] text-ink">
          <input type="checkbox" name="isActive" className="size-4 accent-brand" defaultChecked={state.values ? state.values.isActive === "on" : (initial?.isActive ?? true)} />
          Active (available when generating tasks)
        </label>
      </div>

      <section aria-labelledby="steps-title" className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 id="steps-title" className="text-[14px] font-semibold text-ink">
            Steps <span className="font-normal text-muted">({steps.length})</span>
          </h2>
          <button type="button" className={buttonClass("secondary", undefined, "sm")} onClick={() => setSteps((l) => [...l, blankStep()])}>
            <Plus /> Add step
          </button>
        </div>
        {stepErrors.length ? <Alert tone="error">{stepErrors.join(" ")}</Alert> : null}
        <ol className="space-y-2">
          {steps.map((s, i) => {
            const depIndex = s.dependsOnKey !== null ? indexOf.get(s.dependsOnKey) : undefined;
            const depInvalid = depIndex !== undefined && depIndex >= i;
            const id = `step-${s.key}`;
            return (
              <li key={s.key} className="rounded-lg border border-line bg-surface p-3">
                <div className="flex items-start gap-2">
                  <span className="mt-1.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-subtle text-[12px] font-semibold tabular text-ink" aria-hidden>
                    {i + 1}
                  </span>
                  <div className="grid min-w-0 flex-1 gap-2 md:grid-cols-6">
                    <div className="md:col-span-4">
                      <label htmlFor={`${id}-title`} className="sr-only">
                        Step {i + 1} title
                      </label>
                      <input id={`${id}-title`} value={s.title} onChange={(e) => update(s.key, { title: e.target.value })} maxLength={300} placeholder={`Step ${i + 1}, e.g. Request tax documents`} className={inputClass} />
                    </div>
                    <div className="md:col-span-2">
                      <label htmlFor={`${id}-due`} className="sr-only">
                        Due after (days)
                      </label>
                      <div className="flex items-center gap-1.5 text-[12px] text-muted">
                        <input id={`${id}-due`} value={s.relativeDueDays} onChange={(e) => update(s.key, { relativeDueDays: e.target.value.replace(/\D/g, "").slice(0, 3) })} inputMode="numeric" placeholder="—" className={cx(inputClass, "w-16 tabular")} />
                        days after start
                      </div>
                    </div>
                    <div className="md:col-span-6">
                      <label htmlFor={`${id}-desc`} className="sr-only">
                        Step {i + 1} description
                      </label>
                      <input id={`${id}-desc`} value={s.description} onChange={(e) => update(s.key, { description: e.target.value })} maxLength={2000} placeholder="Description (optional)" className={inputClass} />
                    </div>
                    <label className="flex flex-col gap-1 text-[12px] text-muted md:col-span-2">
                      Assign to
                      <select value={s.defaultAssignee} onChange={(e) => update(s.key, { defaultAssignee: e.target.value as Role })} disabled={s.isClientTask} className={inputClass}>
                        {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex flex-col gap-1 text-[12px] text-muted md:col-span-2">
                      Priority
                      <select value={s.defaultPriority} onChange={(e) => update(s.key, { defaultPriority: e.target.value as Priority })} className={inputClass}>
                        {PRIORITIES.map((p) => (
                          <option key={p} value={p}>
                            {PRIORITY_LABELS[p]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex flex-col gap-1 text-[12px] text-muted md:col-span-2">
                      Waits for
                      <select value={s.dependsOnKey ?? ""} onChange={(e) => update(s.key, { dependsOnKey: e.target.value ? Number(e.target.value) : null })} aria-invalid={depInvalid || undefined} className={inputClass}>
                        <option value="">Nothing</option>
                        {steps.slice(0, i).map((o, j) => (
                          <option key={o.key} value={o.key}>
                            Step {j + 1}: {o.title || "Untitled"}
                          </option>
                        ))}
                        {depInvalid ? <option value={s.dependsOnKey!}>A later step (will be removed)</option> : null}
                      </select>
                    </label>
                    <label className="flex items-center gap-2 text-[13px] text-ink md:col-span-6">
                      <input type="checkbox" checked={s.isClientTask} onChange={(e) => update(s.key, { isClientTask: e.target.checked })} className="size-4 accent-brand" />
                      Client request (shown in the client’s portal)
                    </label>
                  </div>
                  <div className="flex shrink-0 flex-col gap-1">
                    <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="rounded p-1 text-muted hover:bg-subtle hover:text-ink disabled:opacity-30" aria-label={`Move step ${i + 1} up`}>
                      <ArrowUp className="size-4" />
                    </button>
                    <button type="button" onClick={() => move(i, 1)} disabled={i === steps.length - 1} className="rounded p-1 text-muted hover:bg-subtle hover:text-ink disabled:opacity-30" aria-label={`Move step ${i + 1} down`}>
                      <ArrowDown className="size-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (steps.length === 1) return;
                        if (!s.title || window.confirm(`Remove step ${i + 1}?`)) remove(s.key);
                      }}
                      disabled={steps.length === 1}
                      className="rounded p-1 text-muted hover:bg-subtle hover:text-danger-ink disabled:opacity-30"
                      aria-label={`Remove step ${i + 1}`}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      <div className="flex justify-end gap-2 border-t border-line pt-4">
        <SubmitButton pendingText="Saving…">{templateId ? "Save template" : "Create template"}</SubmitButton>
      </div>
      <p className="text-[12px] text-muted">Changing a template doesn’t change tasks already generated from it.</p>
    </form>
  );
}

export function TemplateActiveToggle({ templateId, active }: { templateId: string; active: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      className={buttonClass("ghost", undefined, "sm")}
      onClick={() =>
        start(async () => {
          toast.fromState(await setTemplateActiveAction(templateId, !active));
          router.refresh();
        })
      }
    >
      {active ? "Deactivate" : "Activate"}
    </button>
  );
}
