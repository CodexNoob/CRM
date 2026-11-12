import type { Metadata } from "next";
import { ShieldAlert } from "lucide-react";
import { getDb } from "@/db";
import { DocumentList } from "@/components/documents";
import { PageHeader } from "@/components/ui";
import { requireStaffActor } from "@/lib/auth/current";
import { listRecentDocuments } from "@/services/documents";

export const metadata: Metadata = { title: "Documents" };

export default async function DocumentsPage() {
  const actor = await requireStaffActor();
  const docs = await listRecentDocuments(getDb(), actor, 300);
  return (
    <>
      <PageHeader title="Documents" description="Files across all your clients. Upload from a client’s profile, or clients send them from their portal." />
      <p className="mb-3 flex items-start gap-2 text-[12.5px] text-muted">
        <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        Files are private and downloaded only after a permission check; every download is logged. No malware scanner is connected yet, so files show “Not scanned”.
      </p>
      <DocumentList docs={docs.map((d) => ({ ...d, createdAt: d.createdAt.toISOString() }))} staff showClient />
    </>
  );
}
