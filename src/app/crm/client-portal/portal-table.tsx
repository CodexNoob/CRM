"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, MonitorSmartphone, Pause, Play, UserPlus, Users } from "lucide-react";
import { grantPortalAccessAction, invitePortalContactAction, reissuePortalLinkAction, setPortalAccessAction } from "./actions";
import { CellTitle, DataTable } from "@/components/data-table";
import { Dialog } from "@/components/dialog";
import { FormMessage, SelectField, SubmitButton, TextField } from "@/components/form";
import { InviteLink } from "@/components/invite-link";
import { useToast } from "@/components/toast";
import { Badge, buttonClass } from "@/components/ui";
import { idleState, type ActionState } from "@/lib/action-state";

export interface PortalAccessView {
  key: string;
  userId: string;
  name: string;
  email: string;
  isActive: boolean;
  hasPassword: boolean;
  clientId: string;
  clientName: string;
  role: "owner" | "contact" | "viewer";
  status: "active" | "suspended";
  lastSignIn: string | null;
}

export interface PortalPermissions {
  invite: boolean;
  manageAccess: boolean;
  suspend: boolean;
}

const ROLE_LABELS = { owner: "Owner", contact: "Contact", viewer: "Viewer" } as const;
const ROLE_OPTIONS = [
  { value: "owner", label: "Owner — main account holder" },
  { value: "contact", label: "Contact — can use the portal for this client" },
  { value: "viewer", label: "Viewer" },
];
const dateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

/** Login state of the person (not of one client's access). */
const loginState = (r: PortalAccessView) => (!r.isActive ? "deactivated" : r.hasPassword ? "active" : "invited");

export function PortalAccessTable({ rows, clients, perms }: { rows: PortalAccessView[]; clients: { id: string; name: string }[]; perms: PortalPermissions }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [link, setLink] = useState<string | null>(null);
  const [grantFor, setGrantFor] = useState<PortalAccessView | null>(null);

  const run = (p: Promise<ActionState>) =>
    start(async () => {
      const r = await p;
      toast.fromState(r);
      if (r.status === "success" && r.data?.link) setLink(r.data.link);
      router.refresh();
    });

  return (
    <>
      <DataTable
        label="Client portal access"
        rows={rows}
        getId={(r) => r.key}
        rowHref={(r) => `/crm/clients/${r.clientId}`}
        initialSort={{ id: "client", dir: "asc" }}
        search={{ placeholder: "Search person, email or client", text: (r) => `${r.name} ${r.email} ${r.clientName}` }}
        filters={[
          { id: "access", label: "Access", options: [{ value: "active", label: "Active" }, { value: "suspended", label: "Suspended" }], match: (r, v) => r.status === v },
          { id: "login", label: "Login", options: [{ value: "active", label: "Set up" }, { value: "invited", label: "Invited, not set up" }, { value: "deactivated", label: "Deactivated" }], match: (r, v) => loginState(r) === v },
          { id: "role", label: "Role", options: Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label })), match: (r, v) => r.role === v },
        ]}
        columns={[
          { id: "person", header: "Portal user", sort: (r) => r.name.toLowerCase(), cell: (r) => <CellTitle title={r.name} sub={r.email} /> },
          { id: "client", header: "Client", sort: (r) => r.clientName.toLowerCase(), cell: (r) => <span className="text-ink">{r.clientName}</span> },
          { id: "role", header: "Role", sort: (r) => r.role, hideBelow: "md", cell: (r) => <span className="text-muted">{ROLE_LABELS[r.role]}</span> },
          {
            id: "access",
            header: "Access",
            sort: (r) => r.status,
            cell: (r) =>
              r.status === "suspended" ? (
                <Badge tone="danger" dot>Suspended</Badge>
              ) : loginState(r) === "active" ? (
                <Badge tone="good" dot>Active</Badge>
              ) : loginState(r) === "invited" ? (
                <Badge tone="warn" dot>Invited</Badge>
              ) : (
                <Badge dot>Login deactivated</Badge>
              ),
          },
          { id: "last", header: "Last sign-in", sort: (r) => r.lastSignIn, hideBelow: "md", cell: (r) => <span className="tabular text-muted">{r.lastSignIn ? dateFmt.format(new Date(r.lastSignIn)) : "Never"}</span> },
        ]}
        rowActions={(r) => [
          { label: "Open client", icon: <Users />, href: `/crm/clients/${r.clientId}` },
          ...(perms.invite && r.isActive ? [{ label: r.hasPassword ? "New sign-in link" : "Re-send invitation link", icon: <KeyRound />, onSelect: () => run(reissuePortalLinkAction(r.userId, r.clientId)) }] : []),
          ...(perms.manageAccess ? [{ label: "Give access to another client", icon: <UserPlus />, onSelect: () => setGrantFor(r) }] : []),
          ...(perms.suspend
            ? r.status === "active"
              ? [
                  { type: "separator" as const },
                  {
                    label: "Suspend access to this client",
                    icon: <Pause />,
                    danger: true,
                    disabled: pending,
                    onSelect: () => {
                      if (window.confirm(`Suspend ${r.name}'s portal access to ${r.clientName}? They keep access to any other clients.`)) run(setPortalAccessAction(r.userId, r.clientId, "suspended"));
                    },
                  },
                ]
              : [{ type: "separator" as const }, { label: "Restore access", icon: <Play />, onSelect: () => run(setPortalAccessAction(r.userId, r.clientId, "active")) }]
            : []),
        ]}
        empty={{ title: "No portal access yet", body: perms.invite ? "Invite a client contact with “Invite contact”." : "Ask an admin or manager to invite client contacts.", icon: <MonitorSmartphone /> }}
      />

      <Dialog open={!!link} onClose={() => setLink(null)} title="One-time sign-in link" description="Send it through a trusted channel (not a public chat). It works once and expires in 72 hours.">
        {link ? <InviteLink link={link} id="portal-reissue-link" /> : null}
      </Dialog>

      <GrantDialog key={grantFor?.key ?? "none"} row={grantFor} clients={clients} onClose={() => setGrantFor(null)} />
    </>
  );
}

function GrantDialog({ row, clients, onClose }: { row: PortalAccessView | null; clients: { id: string; name: string }[]; onClose: () => void }) {
  const [state, action] = useActionState(grantPortalAccessAction, idleState);
  const router = useRouter();
  const toast = useToast();
  useEffect(() => {
    if (state.status !== "success") return;
    toast.success(state.message ?? "Access granted.");
    onClose();
    router.refresh();
    // Run once per successful submission.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  return (
    <Dialog open={!!row} onClose={onClose} title="Give access to another client" description={row ? `${row.name} (${row.email}) will be able to switch to this client in their portal.` : undefined}>
      {row ? (
        <form action={action} className="space-y-3" noValidate>
          <FormMessage state={state} />
          <input type="hidden" name="userId" value={row.userId} />
          <SelectField name="clientId" label="Client" required state={state} placeholder="Choose a client" options={clients.filter((c) => c.id !== row.clientId).map((c) => ({ value: c.id, label: c.name }))} />
          <SelectField name="role" label="Role" state={state} defaultValue="contact" options={ROLE_OPTIONS} />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className={buttonClass("ghost")}>
              Cancel
            </button>
            <SubmitButton pendingText="Granting…">Grant access</SubmitButton>
          </div>
        </form>
      ) : null}
    </Dialog>
  );
}

/** "Invite contact" — new or existing portal login of this firm, for one client. */
export function InviteContactButton({ clients }: { clients: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(0);
  return (
    <>
      <button type="button" className={buttonClass("primary")} onClick={() => setOpen(true)}>
        <UserPlus /> Invite contact
      </button>
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
          setKey((k) => k + 1);
        }}
        title="Invite a client contact"
        description="Creates a portal login (or adds this client to an existing one) and a one-time link to set a password."
      >
        <InviteForm key={key} clients={clients} />
      </Dialog>
    </>
  );
}

function InviteForm({ clients }: { clients: { id: string; name: string }[] }) {
  const [state, action] = useActionState(invitePortalContactAction, idleState);
  const router = useRouter();
  if (state.status === "success" && state.data?.link) {
    return (
      <div className="space-y-3">
        <FormMessage state={state} />
        <InviteLink link={state.data.link} id="portal-invite-link" />
        <button type="button" className={buttonClass("ghost", "w-full")} onClick={() => router.refresh()}>
          Done
        </button>
      </div>
    );
  }
  return (
    <form action={action} className="space-y-3" noValidate>
      <FormMessage state={state} />
      <SelectField name="clientId" label="Client" required state={state} placeholder="Choose a client" options={clients.map((c) => ({ value: c.id, label: c.name }))} />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField name="name" label="Name" required autoComplete="off" state={state} />
        <TextField name="email" label="Email" type="email" inputMode="email" required autoComplete="off" state={state} />
      </div>
      <SelectField name="role" label="Role" state={state} defaultValue="contact" options={ROLE_OPTIONS} />
      <p className="text-xs text-muted">Portal users only see this client’s shared documents, their conversations, invoices and requests — never internal notes or other clients.</p>
      <SubmitButton pendingText="Creating…" className="w-full">
        Create invitation link
      </SubmitButton>
    </form>
  );
}
