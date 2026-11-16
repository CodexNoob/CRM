import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { SimpleTable, td } from "@/components/table";
import { Badge, PageHeader, Panel } from "@/components/ui";
import { requireStaffActor } from "@/lib/auth/current";
import { formatDate } from "@/lib/labels";
import { listPlatformInquiries, getPlatformProfile } from "@/services/settings";
import { PlatformInquiryStatusForm, PlatformProfileForm } from "./platform-settings-forms";

export const metadata: Metadata = { title: "Platform Settings" };

const inquiryStatusLabel: Record<string, string> = {
  new: "New",
  in_progress: "In progress",
  resolved: "Resolved",
};

function isInquiryStatus(status: string): status is "new" | "in_progress" | "resolved" {
  return status === "new" || status === "in_progress" || status === "resolved";
}

export default async function PlatformSettingsPage() {
  const actor = await requireStaffActor();
  if (actor.role !== "super_admin") notFound();
  const db = getDb();
  const [profile, inquiries] = await Promise.all([
    getPlatformProfile(db),
    listPlatformInquiries(db, actor),
  ]);

  return (
    <>
      <PageHeader title="Platform settings" description="Manage the CRM operator’s public identity and platform-only contact requests." />
      <Panel title="Platform information" description="These details appear on the product website. They are separate from every subscribing organization.">
        <PlatformProfileForm profile={profile} />
      </Panel>
      <div className="mt-5">
        <Panel title="Platform inquiries" description="Root-site inquiries are stored here and never become a firm lead." flush>
          {inquiries.length ? (
            <SimpleTable label="Platform inquiries" headers={[{ label: "Received" }, { label: "Contact" }, { label: "Topic" }, { label: "Message" }, { label: "Status" }, { label: "", align: "right" }]}>
              {inquiries.map((inquiry) => (
                <tr key={inquiry.id}>
                  <td className={`${td} whitespace-nowrap text-muted`}>{formatDate(inquiry.createdAt.toISOString().slice(0, 10))}</td>
                  <td className={td}>
                    <div className="font-medium text-ink">{inquiry.name}</div>
                    <a className="break-all text-xs text-brand-ink underline" href={`mailto:${inquiry.email}`}>{inquiry.email}</a>
                    {inquiry.phone ? <div className="text-xs text-muted">{inquiry.phone}</div> : null}
                  </td>
                  <td className={td}>{inquiry.topic === "technical_support" ? "Technical support" : inquiry.topic === "sales" ? "Sales and pricing" : "General question"}</td>
                  <td className={`${td} min-w-56 max-w-sm whitespace-normal`}>
                    <details>
                      <summary className="cursor-pointer font-medium text-brand-ink">View message</summary>
                      <p className="mt-2 whitespace-pre-wrap text-xs text-muted">{inquiry.message}</p>
                    </details>
                  </td>
                  <td className={td}>
                    <Badge tone={inquiry.status === "resolved" ? "good" : inquiry.status === "new" ? "info" : "warn"}>
                      {inquiryStatusLabel[inquiry.status] ?? "Needs review"}
                    </Badge>
                  </td>
                  <td className={`${td} text-right`}>
                    {isInquiryStatus(inquiry.status) ? (
                      <PlatformInquiryStatusForm id={inquiry.id} status={inquiry.status} />
                    ) : null}
                  </td>
                </tr>
              ))}
            </SimpleTable>
          ) : (
            <div className="px-5 py-8 text-center text-sm text-muted">No platform inquiries have been received.</div>
          )}
        </Panel>
      </div>
    </>
  );
}
