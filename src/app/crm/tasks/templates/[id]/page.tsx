import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { Badge, PageHeader, Panel } from "@/components/ui";
import { requireStaffActor } from "@/lib/auth/current";
import { can } from "@/lib/auth/permissions";
import { PRIORITY_LABELS, SERVICE_LABELS } from "@/lib/labels";
import { listTemplates } from "@/services/workflows";
import { TemplateActiveToggle, TemplateEditor } from "../template-editor";

export const metadata: Metadata = { title: "Workflow template" };

const ROLE_LABELS = { manager: "Engagement manager", staff: "Engagement staff", reviewer: "Reviewer", unassigned: "Unassigned" } as const;

export default async function TemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireStaffActor();
  if (!can(actor, "templates", "view")) notFound();
  const { id } = await params;
  const tpl = (await listTemplates(getDb(), actor)).find((t) => t.id === id);
  if (!tpl) notFound();
  const canEdit = can(actor, "templates", "edit");

  return (
    <>
      <PageHeader
        title={tpl.name}
        description={`${SERVICE_LABELS[tpl.serviceType]} · ${tpl.steps.length} steps`}
        meta={
          <span className="flex items-center gap-2">
            <Link href="/crm/tasks/templates" className="text-[12.5px] text-muted hover:text-ink hover:underline">
              ← Workflow templates
            </Link>
            <Badge tone={tpl.isActive ? "good" : "neutral"} dot>
              {tpl.isActive ? "Active" : "Inactive"}
            </Badge>
          </span>
        }
        actions={can(actor, "templates", "manage") ? <TemplateActiveToggle templateId={tpl.id} active={tpl.isActive} /> : undefined}
      />
      <div className="max-w-4xl">
        {canEdit ? (
          <TemplateEditor
            templateId={tpl.id}
            initial={{
              name: tpl.name,
              description: tpl.description,
              serviceType: tpl.serviceType,
              isActive: tpl.isActive,
              steps: tpl.steps.map((s) => ({
                title: s.title,
                description: s.description,
                defaultPriority: s.defaultPriority,
                relativeDueDays: s.relativeDueDays,
                defaultAssignee: s.defaultAssignee,
                dependsOnSequence: s.dependsOnSequence,
                isClientTask: s.isClientTask,
              })),
            }}
          />
        ) : (
          <Panel title="Steps">
            <ol className="space-y-2 text-[13px]">
              {tpl.steps.map((s) => (
                <li key={s.id} className="flex flex-wrap items-baseline gap-x-2">
                  <span className="tabular text-muted">{s.sequence}.</span>
                  <span className="font-medium text-ink">{s.title}</span>
                  <span className="text-[12px] text-muted">
                    {s.isClientTask ? "Client request" : ROLE_LABELS[s.defaultAssignee]} · {PRIORITY_LABELS[s.defaultPriority]}
                    {s.relativeDueDays !== null ? ` · due ${s.relativeDueDays} days after start` : ""}
                    {s.dependsOnSequence ? ` · waits for step ${s.dependsOnSequence}` : ""}
                  </span>
                </li>
              ))}
            </ol>
          </Panel>
        )}
      </div>
    </>
  );
}
