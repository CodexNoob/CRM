import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Plus, Workflow } from "lucide-react";
import { getDb } from "@/db";
import { SimpleTable, td } from "@/components/table";
import { Badge, ButtonLink, EmptyState, PageHeader, Panel } from "@/components/ui";
import { requireStaffActor } from "@/lib/auth/current";
import { can } from "@/lib/auth/permissions";
import { SERVICE_LABELS } from "@/lib/labels";
import { listTemplates } from "@/services/workflows";
import { TemplateActiveToggle } from "./template-editor";

export const metadata: Metadata = { title: "Workflow templates" };

export default async function TemplatesPage() {
  const actor = await requireStaffActor();
  if (!can(actor, "templates", "view")) notFound();
  const templates = await listTemplates(getDb(), actor);
  const canEdit = can(actor, "templates", "edit");
  const canManage = can(actor, "templates", "manage");

  return (
    <>
      <PageHeader
        title="Workflow templates"
        description="Reusable task sequences for each service. Managers generate an engagement’s tasks from a template on the engagement page, after reviewing assignees and due dates."
        meta={
          <Link href="/crm/tasks" className="text-[12.5px] text-muted hover:text-ink hover:underline">
            ← Tasks & Workflows
          </Link>
        }
        actions={
          can(actor, "templates", "create") ? (
            <ButtonLink href="/crm/tasks/templates/new">
              <Plus /> New template
            </ButtonLink>
          ) : undefined
        }
      />
      <Panel flush>
        {templates.length ? (
          <SimpleTable label="Workflow templates" headers={[{ label: "Template" }, { label: "Service", hideBelow: "sm" }, { label: "Steps", align: "right" }, { label: "Status" }, { label: "", align: "right" }]}>
            {templates.map((t) => (
              <tr key={t.id}>
                <td className={td}>
                  <Link href={`/crm/tasks/templates/${t.id}`} className="font-medium text-ink hover:text-brand hover:underline">
                    {t.name}
                  </Link>
                  {t.description ? <p className="text-[12px] text-muted">{t.description}</p> : null}
                </td>
                <td className={`${td} hidden text-muted sm:table-cell`}>{SERVICE_LABELS[t.serviceType]}</td>
                <td className={`${td} text-right tabular`}>{t.steps.length}</td>
                <td className={td}>
                  <Badge tone={t.isActive ? "good" : "neutral"} dot>
                    {t.isActive ? "Active" : "Inactive"}
                  </Badge>
                </td>
                <td className={`${td} whitespace-nowrap text-right`}>
                  {canEdit ? (
                    <ButtonLink href={`/crm/tasks/templates/${t.id}`} variant="ghost" size="sm">
                      Edit
                    </ButtonLink>
                  ) : null}
                  {canManage ? <TemplateActiveToggle templateId={t.id} active={t.isActive} /> : null}
                </td>
              </tr>
            ))}
          </SimpleTable>
        ) : (
          <EmptyState icon={<Workflow />} title="No templates yet" />
        )}
      </Panel>
    </>
  );
}
