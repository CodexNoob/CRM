import type { Metadata } from "next";
import { getDb } from "@/db";
import { portalMessageAction } from "@/app/actions/phase1";
import { MessageThread } from "@/components/message-thread";
import { Card, PageHeader } from "@/components/ui";
import { requireClientActor } from "@/lib/auth/current";
import { getThread } from "@/services/messages";

export const metadata: Metadata = { title: "Messages" };
export const dynamic = "force-dynamic";

export default async function PortalMessagesPage() {
  const actor = await requireClientActor();
  const thread = await getThread(getDb(), actor);
  return (
    <>
      <PageHeader title="Messages" description="A private conversation with your firm." />
      <Card>
        <MessageThread
          messages={thread.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() }))}
          action={portalMessageAction}
          emptyText="No messages yet. Ask us anything about your return."
        />
      </Card>
    </>
  );
}
