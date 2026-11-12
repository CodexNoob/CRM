import type { Metadata } from "next";
import Link from "next/link";
import { Check, MessageSquare, SquareCheckBig, Users } from "lucide-react";
import { getDb } from "@/db";
import type { EngagementStatus } from "@/db/schema";
import { updateEngagementAction } from "@/app/actions/staff";
import { Badge, ButtonLink, EmptyState, Panel, cx } from "@/components/ui";
import { requireStaffActor } from "@/lib/auth/current";
import { formatDate, PORTAL_STATUS, SERVICE_LABELS, STATUS_LABELS } from "@/lib/labels";
import { orNotFound } from "@/lib/page-helpers";
import { dueLabel, ENGAGEMENT_TONE } from "@/lib/status";
import { firmToday } from "@/services/dashboard";
import { getEngagement, listStaff } from "@/services/engagements";
import { EngagementForm } from "../../engagement-form";
import { TaskForm, TaskToggle } from "./task-controls";

export const metadata: Metadata = { title: "Engagement" };

const STAGES: EngagementStatus[] = ["not_started", "waiting_on_client", "in_progress", "in_review", "ready_to_file", "filed"];

export default async function EngagementPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireStaffActor();
  const { id } = await params;
  const db = getDb();
  const detail = await orNotFound(getEngagement(db, actor, id));
  const staff = await listStaff(db, actor);
  const assignableStaff = actor.role === "preparer" ? staff.filter((member) => member.id === actor.userId) : staff;
  const { engagement: e, tasks } = detail;
  const today = firmToday();
  const open = tasks.filter((t) => t.status === "open");
  const done = tasks.length - open.length;
  const stageIndex = e.status === "completed" ? STAGES.length : STAGES.indexOf(e.status);
  const due = dueLabel(e.dueDate, today);

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-line bg-surface">
        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[18px] font-semibold leading-7 text-ink">{e.title}</h1>
              <Badge tone={ENGAGEMENT_TONE[e.status]} dot>{STATUS_LABELS[e.status]}</Badge>
            </div>
            <p className="mt-0.5 text-[13px] text-muted">
              <Link href={`/staff/clients/${e.clientId}`} className="text-ink hover:underline">{detail.clientName}</Link>
              {" · "}
              {SERVICE_LABELS[e.serviceType]}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <ButtonLink href={`/staff/clients/${e.clientId}?tab=messages`} variant="secondary"><MessageSquare /> Message client</ButtonLink>
            <ButtonLink href={`/staff/clients/${e.clientId}`} variant="secondary"><Users /> Client profile</ButtonLink>
          </div>
        </div>
        <dl className="grid grid-cols-2 border-t border-line text-[13px] sm:grid-cols-4">
          {[
            ["Tax year", e.taxYear ?? "—"],
            ["Owner", detail.ownerName],
            ["Due", <span key="d" className="flex items-center gap-2"><span className="tabular">{formatDate(e.dueDate)}</span>{e.dueDate && e.status !== "filed" && e.status !== "completed" ? <Badge tone={due.tone}>{due.text}</Badge> : null}</span>],
            ["Tasks", `${open.length} open · ${done} done`],
          ].map(([k, v]) => (
            <div key={k as string} className="border-r border-line px-4 py-2.5 last:border-r-0">
              <dt className="text-[12px] text-muted">{k}</dt>
              <dd className="mt-0.5 font-medium text-ink">{v}</dd>
            </div>
          ))}
        </dl>
        {/* Stage progress */}
        <ol className="flex border-t border-line" aria-label="Engagement stage">
          {STAGES.map((s, i) => {
            const state = i < stageIndex ? "done" : i === stageIndex ? "current" : "todo";
            return (
              <li key={s} className={cx("flex min-w-0 flex-1 items-center gap-1.5 border-r border-line px-3 py-2 text-[12px] last:border-r-0", state === "current" ? "bg-brand-soft/60 font-medium text-brand" : state === "done" ? "text-ink" : "text-faint")} aria-current={state === "current" ? "step" : undefined}>
                <span aria-hidden className={cx("flex size-4 shrink-0 items-center justify-center rounded-full border text-[9px]", state === "done" ? "border-success bg-success text-white" : state === "current" ? "border-brand bg-brand text-white" : "border-line-strong")}>
                  {state === "done" ? <Check className="size-2.5" strokeWidth={3} /> : i + 1}
                </span>
                <span className="hidden truncate md:inline">{STATUS_LABELS[s]}</span>
              </li>
            );
          })}
        </ol>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1fr_22rem]">
        <div className="space-y-5">
          <Panel title="Tasks" description={`${open.length} open · ${done} completed`} flush>
            {tasks.length ? (
              <ul className="divide-y divide-line">
                {tasks.map((t) => {
                  const d = dueLabel(t.dueDate, today);
                  return (
                    <li key={t.id} className="flex items-center gap-3 px-4 py-2.5">
                      <TaskToggle taskId={t.id} done={t.status === "done"} title={t.title} />
                      <div className="min-w-0 flex-1">
                        <p className={cx("text-[13px]", t.status === "done" ? "text-faint line-through" : "font-medium text-ink")}>{t.title}</p>
                        <p className="text-[12px] text-muted">{t.isClientTask ? "Client request · visible in portal" : (t.assigneeName ?? "Unassigned")}</p>
                      </div>
                      {t.isClientTask ? <Badge tone="warn">Client</Badge> : null}
                      {t.dueDate ? <Badge tone={t.status === "done" ? "neutral" : d.tone}>{t.status === "done" ? formatDate(t.dueDate) : d.text}</Badge> : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState icon={<SquareCheckBig />} title="No tasks yet">Add internal steps, or client requests the client will see in their portal.</EmptyState>
            )}
          </Panel>
          <Panel title="Add a task">
            <TaskForm engagementId={e.id} staff={assignableStaff} />
          </Panel>
        </div>
        <div className="space-y-5">
          <Panel title="Engagement details">
            <EngagementForm action={updateEngagementAction.bind(null, e.id)} staff={assignableStaff} initial={e} submitLabel="Save changes" />
          </Panel>
          <Panel title="Client portal view" description="What the client sees">
            <Badge tone={ENGAGEMENT_TONE[e.status]} dot>{PORTAL_STATUS[e.status].label}</Badge>
            <p className="mt-2 text-[13px] text-muted">{PORTAL_STATUS[e.status].description}</p>
          </Panel>
        </div>
      </div>
    </div>
  );
}
