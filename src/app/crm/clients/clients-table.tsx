"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, Briefcase, MessageSquare, Pencil, Users } from "lucide-react";
import { archiveClientAction } from "@/app/actions/crm";
import { CellTitle, DataTable } from "@/components/data-table";
import { Dialog } from "@/components/dialog";
import { useToast } from "@/components/toast";
import { Badge, buttonClass, ButtonLink } from "@/components/ui";
import type { ClientStatus, ClientType, OnboardingStatus } from "@/db/schema";
import { CLIENT_STATUS_LABELS, CLIENT_TYPE_LABELS, ONBOARDING_STATUS_LABELS, recordNumber } from "@/lib/labels";
import { CLIENT_STATUS_TONE, ONBOARDING_TONE } from "@/lib/status";

export interface ClientRow {
  id: string;
  clientNumber: number | null;
  displayName: string;
  type: ClientType;
  status: ClientStatus;
  onboardingStatus: OnboardingStatus;
  email: string | null;
  phone: string | null;
  accountManagerName: string | null;
  openEngagements: number;
  pendingTasks: number;
  portalUsers: number;
  archivedAt: string | null;
  createdAt: string;
}

const dateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

export function ClientsTable({ rows, archivedView, canArchive, canCreate }: { rows: ClientRow[]; archivedView: boolean; canArchive: boolean; canCreate: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [confirm, setConfirm] = useState<ClientRow | null>(null);
  const [busy, setBusy] = useState(false);

  const runArchive = async (row: ClientRow) => {
    setBusy(true);
    const r = await archiveClientAction(row.id, !row.archivedAt);
    setBusy(false);
    setConfirm(null);
    toast.fromState(r);
    router.refresh();
  };

  return (
    <>
      <DataTable
        label="Clients"
        rows={rows}
        getId={(r) => r.id}
        rowHref={(r) => `/crm/clients/${r.id}`}
        initialSort={{ id: "name", dir: "asc" }}
        search={{ placeholder: "Search name, email, phone or number", text: (r) => `${r.displayName} ${r.email ?? ""} ${r.phone ?? ""} ${recordNumber("C", r.clientNumber) ?? ""}` }}
        filters={[{ id: "portal", label: "Portal", options: [{ value: "yes", label: "Has access" }, { value: "no", label: "No access" }], match: (r, v) => (v === "yes" ? r.portalUsers > 0 : r.portalUsers === 0) }]}
        columns={[
          {
            id: "name",
            header: "Client",
            sort: (r) => r.displayName.toLowerCase(),
            cell: (r) => (
              <CellTitle
                title={r.displayName}
                sub={[recordNumber("C", r.clientNumber), r.email ?? r.phone ?? "No contact details"].filter(Boolean).join(" · ")}
                href={`/crm/clients/${r.id}`}
              />
            ),
          },
          { id: "type", header: "Type", sort: (r) => r.type, hideBelow: "md", cell: (r) => <span className="text-muted">{CLIENT_TYPE_LABELS[r.type]}</span> },
          {
            id: "status",
            header: "Status",
            sort: (r) => r.status,
            cell: (r) => (
              <Badge tone={r.archivedAt ? "neutral" : CLIENT_STATUS_TONE[r.status]} dot>
                {r.archivedAt ? "Archived" : CLIENT_STATUS_LABELS[r.status]}
              </Badge>
            ),
          },
          {
            id: "onboarding",
            header: "Onboarding",
            sort: (r) => r.onboardingStatus,
            hideBelow: "sm",
            cell: (r) => <Badge tone={ONBOARDING_TONE[r.onboardingStatus]}>{ONBOARDING_STATUS_LABELS[r.onboardingStatus]}</Badge>,
          },
          { id: "manager", header: "Account manager", sort: (r) => r.accountManagerName, hideBelow: "lg", cell: (r) => <span className="text-muted">{r.accountManagerName ?? "—"}</span> },
          { id: "open", header: "Open engagements", align: "right", sort: (r) => r.openEngagements, hideBelow: "md", cell: (r) => <span className="tabular">{r.openEngagements}</span> },
          { id: "tasks", header: "Pending tasks", align: "right", sort: (r) => r.pendingTasks, hideBelow: "md", cell: (r) => <span className="tabular">{r.pendingTasks}</span> },
          { id: "added", header: "Added", sort: (r) => r.createdAt, hideBelow: "lg", cell: (r) => <span className="tabular text-muted">{dateFmt.format(new Date(r.createdAt))}</span> },
        ]}
        rowActions={(r) => [
          { label: "Open client", icon: <Users />, href: `/crm/clients/${r.id}` },
          { label: "Edit details", icon: <Pencil />, href: `/crm/clients/${r.id}/edit` },
          { label: "New engagement", icon: <Briefcase />, href: `/crm/clients/${r.id}/engagements/new` },
          { label: "Message", icon: <MessageSquare />, href: `/crm/messages/${r.id}` },
          ...(canArchive
            ? [
                { type: "separator" as const },
                r.archivedAt
                  ? { label: "Restore client", icon: <ArchiveRestore />, onSelect: () => setConfirm(r) }
                  : { label: "Archive client", icon: <Archive />, danger: true, onSelect: () => setConfirm(r) },
              ]
            : []),
        ]}
        empty={
          archivedView
            ? { title: "No archived clients", icon: <Archive /> }
            : {
                title: "No clients match",
                body: "Add a client, convert a lead, or clear the filters.",
                action: canCreate ? <ButtonLink href="/crm/clients/new">New client</ButtonLink> : undefined,
                icon: <Users />,
              }
        }
      />

      <Dialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        size="sm"
        title={confirm?.archivedAt ? "Restore client?" : "Archive client?"}
        footer={
          <>
            <button type="button" className={buttonClass("secondary")} onClick={() => setConfirm(null)}>
              Cancel
            </button>
            <button type="button" disabled={busy} className={buttonClass(confirm?.archivedAt ? "primary" : "danger")} onClick={() => confirm && void runArchive(confirm)}>
              {busy ? "Saving…" : confirm?.archivedAt ? "Restore" : "Archive"}
            </button>
          </>
        }
      >
        <p className="text-[13px] text-ink">
          {confirm?.archivedAt
            ? `${confirm.displayName} will appear in the client list again.`
            : `${confirm?.displayName} will be hidden from the client list. Nothing is deleted: engagements, documents, messages and history are kept, and you can restore the client at any time.`}
        </p>
      </Dialog>
    </>
  );
}
