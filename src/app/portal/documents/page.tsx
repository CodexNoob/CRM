import type { Metadata } from "next";
import { getDb } from "@/db";
import { portalUploadAction } from "@/app/actions/phase1";
import { DocumentList, UploadForm } from "@/components/documents";
import { Card, PageHeader } from "@/components/ui";
import { requireClientActor } from "@/lib/auth/current";
import { listPortalDocuments } from "@/services/documents";

export const metadata: Metadata = { title: "Documents" };

export default async function PortalDocumentsPage() {
  const actor = await requireClientActor();
  const docs = await listPortalDocuments(getDb(), actor);
  return (
    <>
      <PageHeader title="Documents" description="Send your tax documents securely and download files we’ve shared with you." />
      <div className="space-y-6">
        <Card title="Send us a document">
          <UploadForm action={portalUploadAction} label="Choose a file" />
          <p className="mt-3 text-xs text-muted">Files go only to your firm. This is safer than email for W-2s, 1099s, statements and IDs.</p>
        </Card>
        <Card title="Your documents">
          <DocumentList docs={docs.map((d) => ({ ...d, createdAt: d.createdAt.toISOString() }))} />
        </Card>
      </div>
    </>
  );
}
