"use client";

import { startTransition, useActionState, useEffect, useRef } from "react";
import { KeyRound, MoreHorizontal, UserCheck, UserX } from "lucide-react";
import { changeStaffRoleAction, inviteStaffAction, sendStaffLinkAction, setStaffActiveAction } from "@/app/actions/team";
import { FormMessage, SelectField, SubmitButton, TextField, inputClass } from "@/components/form";
import { InviteLink } from "@/components/invite-link";
import { Menu } from "@/components/menu";
import { cx } from "@/components/ui";
import { idleState } from "@/lib/action-state";
import { ROLE_LABELS } from "@/lib/labels";

const roleOptions = (["admin", "partner", "preparer"] as const).map((r) => ({ value: r, label: ROLE_LABELS[r] }));

export function InviteStaffForm() {
  const [state, action] = useActionState(inviteStaffAction, idleState);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.status === "success") formRef.current?.reset();
  }, [state]);
  const fieldState = state.status === "success" ? { ...state, values: undefined } : state;
  const link = state.status === "success" ? state.data?.link : undefined;

  return (
    <form ref={formRef} action={action} className="space-y-3" noValidate>
      <FormMessage state={state} />
      {link ? <InviteLink link={link} id="staff-invite-link" /> : null}
      <TextField name="name" label="Name" required state={fieldState} />
      <TextField name="email" label="Work email" type="email" inputMode="email" autoComplete="off" required state={fieldState} />
      <SelectField name="role" label="Role" required state={fieldState} defaultValue="preparer" options={roleOptions} />
      <SubmitButton pendingText="Creating…" className="w-full">Create invitation link</SubmitButton>
    </form>
  );
}

/** Inline role editor for a table row. Saves on change. */
export function RoleSelect({ userId, name, role, disabled }: { userId: string; name: string; role: string; disabled?: boolean }) {
  const [state, action, pending] = useActionState(changeStaffRoleAction.bind(null, userId), idleState);
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <form ref={formRef} action={action} className="space-y-1">
      <label htmlFor={`role-${userId}`} className="sr-only">Role for {name}</label>
      <select
        id={`role-${userId}`}
        name="role"
        defaultValue={role}
        disabled={disabled || pending}
        onChange={() => formRef.current?.requestSubmit()}
        className={cx(inputClass, "w-40")}
      >
        {roleOptions.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      {state.status !== "idle" ? (
        <p role={state.status === "error" ? "alert" : "status"} className={cx("text-[12px]", state.status === "error" ? "text-danger-ink" : "text-success")}>
          {state.status === "error" ? (state.fieldErrors?._form?.join(" ") ?? state.message) : "Saved. They’ll sign in again."}
        </p>
      ) : null}
    </form>
  );
}

/** Row menu: new sign-in link (password reset) and deactivate / reactivate. */
export function MemberMenu({ userId, name, isActive }: { userId: string; name: string; isActive: boolean }) {
  const [linkState, linkAction] = useActionState(sendStaffLinkAction.bind(null, userId), idleState);
  const [activeState, activeAction] = useActionState(setStaffActiveAction.bind(null, userId, !isActive), idleState);
  const link = linkState.status === "success" ? linkState.data?.link : undefined;
  const error = [linkState, activeState].find((s) => s.status === "error");

  return (
    <div className="flex flex-col items-end gap-2">
      <Menu
        label={`Actions for ${name}`}
        trigger={<MoreHorizontal className="size-4" aria-hidden />}
        triggerClassName="inline-flex size-7 items-center justify-center rounded-md text-muted hover:bg-subtle hover:text-ink"
        items={[
          ...(isActive ? [{ label: "New sign-in link", icon: <KeyRound />, onSelect: () => startTransition(() => linkAction(new FormData())) }] : []),
          { type: "separator" as const },
          isActive
            ? { label: "Deactivate", icon: <UserX />, danger: true, onSelect: () => { if (window.confirm(`Deactivate ${name}? They will be signed out immediately.`)) startTransition(() => activeAction(new FormData())); } }
            : { label: "Reactivate", icon: <UserCheck />, onSelect: () => startTransition(() => activeAction(new FormData())) },
        ]}
      />
      {error ? <p role="alert" className="max-w-56 text-right text-[12px] text-danger-ink">{error.fieldErrors?._form?.join(" ") ?? error.message}</p> : null}
      {link ? (
        <div className="w-72 space-y-1 text-left">
          <p className="text-[12px] text-muted">{linkState.message}</p>
          <InviteLink link={link} id={`link-${userId}`} />
        </div>
      ) : null}
    </div>
  );
}
