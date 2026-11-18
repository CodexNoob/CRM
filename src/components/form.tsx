"use client";

import { useFormStatus } from "react-dom";
import { useState } from "react";
import type { ReactNode } from "react";
import { Eye, EyeOff } from "lucide-react";
import type { ActionState } from "@/lib/action-state";
import { Alert, buttonClass, cx } from "./ui";

export function SubmitButton({
  children,
  pendingText = "Saving…",
  variant = "primary",
  className,
  size = "md",
  disabled = false,
}: {
  children: ReactNode;
  pendingText?: string;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  className?: string;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending || disabled} aria-disabled={pending || disabled} className={buttonClass(variant, className, size)}>
      {pending ? pendingText : children}
    </button>
  );
}

/** Top-of-form summary for errors that are not tied to a single field. */
export function FormMessage({ state }: { state: ActionState }) {
  if (state.status === "error" && state.message) return <Alert tone="error">{state.message}</Alert>;
  if (state.status === "success" && state.message) return <Alert tone="success">{state.message}</Alert>;
  return null;
}

/** Shared control styling. Exported so custom controls (textareas, selects) match exactly. */
export const inputClass =
  "block w-full h-9 sm:h-8 rounded-md border border-line bg-surface px-2.5 text-[13px] text-ink shadow-sm placeholder:text-faint " +
  "transition-colors hover:border-line-strong focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/15 " +
  "aria-[invalid=true]:border-danger aria-[invalid=true]:ring-danger/15 disabled:bg-subtle disabled:text-muted";

export const textareaClass = inputClass.replace("h-9 sm:h-8", "min-h-20 py-2 h-auto sm:h-auto");

interface FieldProps {
  name: string;
  label: string;
  state: ActionState;
  defaultValue?: string | null;
  hint?: string;
  required?: boolean;
}

function useFieldMeta({ name, state }: FieldProps) {
  const errors = state.fieldErrors?.[name];
  const errorId = errors ? `${name}-error` : undefined;
  return { errors, errorId };
}

function FieldShell({ name, label, hint, required, errors, errorId, children }: FieldProps & { errors?: string[]; errorId?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={name} className="block text-[12.5px] font-medium text-ink">
        {label}
        {required ? <span className="text-danger" aria-hidden> *</span> : null}
      </label>
      {children}
      {hint && !errors ? <p className="text-[12px] text-muted">{hint}</p> : null}
      {errors ? (
        <p id={errorId} className="text-[12px] text-danger-ink">
          {errors.join(" ")}
        </p>
      ) : null}
    </div>
  );
}

export function TextField(
  props: FieldProps & { type?: string; autoComplete?: string; placeholder?: string; inputMode?: "text" | "email" | "tel" | "numeric" | "decimal"; min?: number | string; step?: number | string },
) {
  const { errors, errorId } = useFieldMeta(props);
  const value = props.state.values?.[props.name] ?? props.defaultValue ?? "";
  const [passwordVisible, setPasswordVisible] = useState(false);
  const isPassword = props.type === "password";
  return (
    <FieldShell {...props} errors={errors} errorId={errorId}>
      <div className={isPassword ? "relative" : undefined}>
        <input
          id={props.name}
          name={props.name}
          type={isPassword && passwordVisible ? "text" : props.type ?? "text"}
          defaultValue={value}
          key={value}
          required={props.required}
          autoComplete={props.autoComplete}
          placeholder={props.placeholder}
          inputMode={props.inputMode}
          min={props.min}
          step={props.step}
          aria-invalid={errors ? true : undefined}
          aria-describedby={errorId}
          className={isPassword ? cx(inputClass, "pr-10") : inputClass}
        />
        {isPassword ? (
          <button
            type="button"
            onClick={() => setPasswordVisible((visible) => !visible)}
            aria-label={passwordVisible ? "Hide password" : "Show password"}
            aria-pressed={passwordVisible}
            className="absolute inset-y-0 right-1 inline-flex w-8 items-center justify-center rounded text-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            {passwordVisible ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
          </button>
        ) : null}
      </div>
    </FieldShell>
  );
}

export function SelectField(props: FieldProps & { options: { value: string; label: string }[]; placeholder?: string }) {
  const { errors, errorId } = useFieldMeta(props);
  const value = props.state.values?.[props.name] ?? props.defaultValue ?? "";
  return (
    <FieldShell {...props} errors={errors} errorId={errorId}>
      <select
        id={props.name}
        name={props.name}
        defaultValue={value}
        key={value}
        required={props.required}
        aria-invalid={errors ? true : undefined}
        aria-describedby={errorId}
        className={cx(inputClass, "pr-7")}
      >
        {props.placeholder !== undefined ? <option value="">{props.placeholder}</option> : null}
        {props.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}
