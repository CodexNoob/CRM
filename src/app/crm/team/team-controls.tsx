"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { KeyRound, MoreHorizontal, UserCheck, UserPlus, UserX } from "lucide-react";
import { changeStaffRoleAction, inviteStaffAction, sendStaffLinkAction, setStaffActiveAction } from "@/app/actions/team";
import { FormMessage, SelectField, SubmitButton, TextField, inputClass } from "@/components/form";
import { Dialog } from "@/components/dialog";
import { Menu } from "@/components/menu";
import { buttonClass, cx } from "@/components/ui";
import { idleState } from "@/lib/action-state";
import { ROLE_LABELS } from "@/lib/labels";

const roleOptions = (includeSuperAdmin: boolean) =>
  (includeSuperAdmin
    ? ["super_admin", "administrator", "operations_manager", "project_manager", "team_member", "sales_manager", "sales_representative", "finance_manager", "accountant", "marketing_manager", "account_manager", "support_agent", "developer", "read_only"] as const
    : ["administrator", "operations_manager", "project_manager", "team_member", "sales_manager", "sales_representative", "finance_manager", "accountant", "marketing_manager", "account_manager", "support_agent", "developer", "read_only"] as const
  ).map((r) => ({ value: r, label: ROLE_LABELS[r] }));

export function InviteStaffForm({ firmId, canManageSuperAdmins }: { firmId: string; canManageSuperAdmins: boolean }) {
  const [state, action] = useActionState(inviteStaffAction, idleState);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.status === "success") formRef.current?.reset();
  }, [state]);
  const fieldState = state.status === "success" ? { ...state, values: undefined } : state;

  return (
    <form ref={formRef} action={action} className="space-y-3" noValidate>
      <input type="hidden" name="firmId" value={firmId} />
      <FormMessage state={state} />
      <TextField name="name" label="Name" required state={fieldState} />
      <TextField name="email" label="Work email" type="email" inputMode="email" autoComplete="off" required state={fieldState} />
      <SelectField name="role" label="Role" required state={fieldState} defaultValue="team_member" options={roleOptions(canManageSuperAdmins)} />
      <SubmitButton pendingText="Sending invitation..." className="w-full">Send invitation</SubmitButton>
    </form>
  );
}

export function InviteStaffButton({ firmId, canManageSuperAdmins }: { firmId: string; canManageSuperAdmins: boolean }) {
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  return (
    <>
      <button type="button" className={buttonClass("primary")} onClick={() => setOpen(true)}>
        <UserPlus /> Invite a team member
      </button>
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
          setFormKey((key) => key + 1);
        }}
        title="Invite a team member"
        description="Create the staff account and email them a one-time password setup link. It expires after 72 hours."
      >
        <InviteStaffForm key={formKey} firmId={firmId} canManageSuperAdmins={canManageSuperAdmins} />
      </Dialog>
    </>
  );
}

/** Inline role editor for a table row. Saves on change. */
export function RoleSelect({ userId, name, role, firmId, canManageSuperAdmins, disabled }: { userId: string; name: string; role: string; firmId: string; canManageSuperAdmins: boolean; disabled?: boolean }) {
  const [state, action, pending] = useActionState(changeStaffRoleAction.bind(null, userId), idleState);
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <form ref={formRef} action={action} className="space-y-1">
      <input type="hidden" name="firmId" value={firmId} />
      <label htmlFor={`role-${userId}`} className="sr-only">Role for {name}</label>
      <select
        id={`role-${userId}`}
        name="role"
        defaultValue={role === "manager" ? "operations_manager" : role === "employee" ? "team_member" : role}
        disabled={disabled || pending}
        onChange={() => formRef.current?.requestSubmit()}
        className={cx(inputClass, "w-40")}
      >
        {roleOptions(canManageSuperAdmins).map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      {state.status !== "idle" ? (
        <p role={state.status === "error" ? "alert" : "status"} className={cx("text-[12px]", state.status === "error" ? "text-danger-ink" : "text-success")}>
          {state.status === "error" ? (state.fieldErrors?._form?.join(" ") ?? state.message) : "Saved. They will sign in again."}
        </p>
      ) : null}
    </form>
  );
}

/** Row menu: send a password setup email and deactivate / reactivate. */
export function MemberMenu({ userId, name, isActive, firmId }: { userId: string; name: string; isActive: boolean; firmId: string }) {
  const [linkState, linkAction] = useActionState(sendStaffLinkAction.bind(null, userId, firmId), idleState);
  const [activeState, activeAction] = useActionState(setStaffActiveAction.bind(null, userId, !isActive, firmId), idleState);
  const error = [linkState, activeState].find((s) => s.status === "error");

  return (
    <div className="flex flex-col items-end gap-2">
      <Menu
        label={`Actions for ${name}`}
        trigger={<MoreHorizontal className="size-4" aria-hidden />}
        triggerClassName="inline-flex size-7 items-center justify-center rounded-md text-muted hover:bg-subtle hover:text-ink"
        items={[
          ...(isActive ? [{ label: "Send password setup email", icon: <KeyRound />, onSelect: () => startTransition(() => linkAction(new FormData())) }] : []),
          { type: "separator" as const },
          isActive
            ? { label: "Deactivate", icon: <UserX />, danger: true, onSelect: () => { if (window.confirm(`Deactivate ${name}? They will be signed out immediately.`)) startTransition(() => activeAction(new FormData())); } }
            : { label: "Reactivate", icon: <UserCheck />, onSelect: () => startTransition(() => activeAction(new FormData())) },
        ]}
      />
      {error ? <p role="alert" className="max-w-56 text-right text-[12px] text-danger-ink">{error.fieldErrors?._form?.join(" ") ?? error.message}</p> : null}
      {linkState.status === "success" ? <p role="status" className="max-w-56 text-right text-[12px] text-success">{linkState.message}</p> : null}
    </div>
  );
}
