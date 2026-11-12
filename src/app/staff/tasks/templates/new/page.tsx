import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { requireStaffActor } from "@/lib/auth/current";
import { can } from "@/lib/auth/permissions";
import { TemplateEditor } from "../template-editor";

export const metadata: Metadata = { title: "New workflow template" };

export default async function NewTemplatePage() {
  const actor = await requireStaffActor();
  if (!can(actor, "templates", "create")) notFound();
  return (
    <>
      <PageHeader
        title="New workflow template"
        meta={
          <Link href="/staff/tasks/templates" className="text-[12.5px] text-muted hover:text-ink hover:underline">
            ← Workflow templates
          </Link>
        }
      />
      <div className="max-w-4xl">
        <TemplateEditor templateId={null} />
      </div>
    </>
  );
}
