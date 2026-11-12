import { AppError, ValidationError } from "@/lib/errors";

/** Result shape returned by every form Server Action. */
export interface ActionState {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: Record<string, string[]>;
  /** Echo of submitted text values so the form keeps user input after an error. */
  values?: Record<string, string>;
  /** Extra payload for success states (e.g. a one-time invite link). */
  data?: Record<string, string>;
}

export const idleState: ActionState = { status: "idle" };

/** Never echo these fields back to the browser. */
const SECRET_FIELDS = new Set(["password", "confirmPassword", "token", "setupCode"]);

export function formValues(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string" && !key.startsWith("$") && !SECRET_FIELDS.has(key)) values[key] = value;
  }
  return values;
}

/**
 * Converts an error into a safe, user-facing state. Unexpected errors are
 * logged by name/code only (driver errors can embed query parameters, i.e.
 * client data) and shown as a generic message.
 */
export function errorState(error: unknown, formData?: FormData): ActionState {
  const values = formData ? formValues(formData) : undefined;
  if (error instanceof ValidationError) {
    return { status: "error", message: error.message, fieldErrors: error.fieldErrors, values };
  }
  if (error instanceof AppError) {
    return { status: "error", message: error.message, values };
  }
  const e = error as { name?: string; code?: string };
  console.error("Unhandled server action error", { name: e?.name, code: e?.code });
  return { status: "error", message: "Something went wrong. Please try again.", values };
}
