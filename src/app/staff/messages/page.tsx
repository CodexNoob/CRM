import type { Metadata } from "next";
import { MessagesSquare } from "lucide-react";
import { getDb } from "@/db";
import { EmptyState, PageHeader } from "@/components/ui";
import { requireStaffActor } from "@/lib/auth/current";
import { listConversations } from "@/services/messages";
import { Inbox } from "./inbox";

export const metadata: Metadata = { title: "Messages" };

export default async function MessagesPage() {
  const actor = await requireStaffActor();
  const convos = await listConversations(getDb(), actor);
  const unread = convos.reduce((n, c) => n + c.unread, 0);
  return (
    <>
      <PageHeader title="Messages" description={unread ? `${unread} unread message${unread === 1 ? "" : "s"} from clients.` : "Secure conversations with your clients."} />
      <div className="grid overflow-hidden rounded-lg border border-line bg-surface lg:h-[calc(100dvh-11rem)] lg:grid-cols-[22rem_1fr]">
        <div className="overflow-y-auto border-line lg:border-r">
          <Inbox convos={convos} />
        </div>
        <div className="hidden items-center justify-center lg:flex">
          <EmptyState icon={<MessagesSquare />} title="Select a conversation">Choose a client on the left to read and reply.</EmptyState>
        </div>
      </div>
    </>
  );
}
