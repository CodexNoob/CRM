import { z } from "zod";
import { appointmentKind, clientStatus, clientType, engagementStatus, leadSource, serviceType } from "@/db/schema";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/lib/auth/crypto";
import { ValidationError } from "@/lib/errors";

/** HTML forms send "" for blank fields; treat that as "not provided". */
const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

const optionalText = (max: number) =>
  z.preprocess(blankToUndefined, z.string().trim().max(max, `Must be ${max} characters or fewer.`).optional());

const requiredText = (label: string, max: number) =>
  z
    .string({ error: `${label} is required.` })
    .trim()
    .min(1, `${label} is required.`)
    .max(max, `${label} must be ${max} characters or fewer.`);

const isoDate = z.preprocess(
  blankToUndefined,
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the format YYYY-MM-DD.")
    .refine((s) => {
      const d = new Date(`${s}T00:00:00Z`);
      return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
    }, "Enter a real calendar date.")
    .optional(),
);

const uuid = (label: string) => z.uuid(`Choose a valid ${label}.`);

const checkbox = z.preprocess((v) => v === true || v === "on" || v === "true", z.boolean());

export const clientInputSchema = z.object({
  type: z.enum(clientType.enumValues, { error: "Choose a client type." }),
  displayName: requiredText("Name", 200),
  email: z.preprocess(
    blankToUndefined,
    z.email("Enter a valid email address.").max(254).transform((s) => s.toLowerCase()).optional(),
  ),
  phone: z.preprocess(
    blankToUndefined,
    z
      .string()
      .trim()
      .regex(/^[0-9+().\-\s]{7,30}$/, "Enter a valid phone number.")
      .optional(),
  ),
  status: z.enum(clientStatus.enumValues).default("active"),
});
export type ClientInput = z.infer<typeof clientInputSchema>;

export const clientSearchSchema = z.object({
  q: optionalText(100),
});

export const engagementInputSchema = z.object({
  title: requiredText("Title", 200),
  serviceType: z.enum(serviceType.enumValues, { error: "Choose a service." }),
  taxYear: z.preprocess(
    blankToUndefined,
    z.coerce
      .number({ error: "Enter a year." })
      .int("Enter a whole year.")
      .min(2000, "Enter a year from 2000 onward.")
      .max(2100, "Enter a year before 2100.")
      .optional(),
  ),
  status: z.enum(engagementStatus.enumValues, { error: "Choose a status." }).default("not_started"),
  ownerId: uuid("owner"),
  dueDate: isoDate,
});
export type EngagementInput = z.infer<typeof engagementInputSchema>;

export const taskInputSchema = z.object({
  title: requiredText("Task", 300),
  isClientTask: checkbox,
  assigneeId: z.preprocess(blankToUndefined, uuid("assignee").optional()),
  dueDate: isoDate,
});
export type TaskInput = z.infer<typeof taskInputSchema>;

export const portalInviteSchema = z.object({
  name: requiredText("Name", 200),
  email: z.email("Enter a valid email address.").max(254).transform((s) => s.toLowerCase()),
});

/* ───────── Phase 1 ───────── */

const optionalEmail = z.preprocess(
  blankToUndefined,
  z.email("Enter a valid email address.").max(254).transform((s) => s.toLowerCase()).optional(),
);
const optionalPhone = z.preprocess(
  blankToUndefined,
  z.string().trim().regex(/^[0-9+().\-\s]{7,30}$/, "Enter a valid phone number.").optional(),
);
const optionalService = z.preprocess(blankToUndefined, z.enum(serviceType.enumValues, { error: "Choose a service." }).optional());

export const leadInputSchema = z.object({
  name: requiredText("Name", 200),
  email: optionalEmail,
  phone: optionalPhone,
  company: optionalText(200),
  serviceInterest: optionalService,
  source: z.enum(leadSource.enumValues, { error: "Choose a source." }).default("other"),
  message: optionalText(2000),
});

export const leadUpdateSchema = leadInputSchema.extend({
  status: z.enum(["new", "contacted", "qualified", "lost"], { error: "Choose a status." }),
  ownerId: z.preprocess(blankToUndefined, uuid("owner").optional()),
  followUpDate: isoDate,
  notes: optionalText(5000),
});

export const websiteInquirySchema = z.object({
  name: requiredText("Name", 200),
  email: z.email("Enter a valid email address.").max(254).transform((s) => s.toLowerCase()),
  phone: optionalPhone,
  serviceInterest: optionalService,
  message: z.preprocess(blankToUndefined, z.string().trim().max(2000, "Please keep your message under 2,000 characters.").optional()),
  consent: z.preprocess((v) => v === true || v === "on" || v === "true", z.literal(true, { error: "Please check the box to agree to be contacted before sending your message." })),
});

export const messageBodySchema = z
  .string({ error: "Write a message." })
  .trim()
  .min(1, "Write a message.")
  .max(5000, "Messages must be 5,000 characters or fewer.");

const localDateTime = (label: string) =>
  z
    .string({ error: `${label} is required.` })
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, `Enter a valid ${label.toLowerCase()}.`);

export const appointmentInputSchema = z.object({
  title: requiredText("Title", 200),
  clientId: z.preprocess(blankToUndefined, uuid("client").optional()),
  ownerId: uuid("staff member"),
  kind: z.enum(appointmentKind.enumValues, { error: "Choose a type." }),
  startsAt: localDateTime("Start"),
  durationMinutes: z.coerce.number({ error: "Choose a length." }).int().min(5).max(8 * 60),
  location: optionalText(300),
  notes: optionalText(2000),
});

export const staffRoleSchema =z.enum(["admin", "partner", "preparer"], { error: "Choose a role." });

export const staffInviteSchema = z.object({
  name: requiredText("Name", 200),
  email: z.email("Enter a valid email address.").max(254).transform((s) => s.toLowerCase()),
  role: staffRoleSchema,
});

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters.`)
  .max(PASSWORD_MAX_LENGTH, `Use at most ${PASSWORD_MAX_LENGTH} characters.`);

export const idSchema = z.uuid();

/** Parses input or throws a ValidationError carrying per-field messages. */
export function parseInput<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const flat = z.flattenError(result.error);
  const fieldErrors: Record<string, string[]> = {};
  for (const [key, messages] of Object.entries(flat.fieldErrors as Record<string, string[] | undefined>)) {
    if (messages?.length) fieldErrors[key] = messages;
  }
  if (flat.formErrors.length) fieldErrors._form = flat.formErrors;
  throw new ValidationError(fieldErrors);
}

/** An id from a URL or form that is not a UUID can never match a record. */
export function isUuid(value: unknown): value is string {
  return idSchema.safeParse(value).success;
}

/* ───────── Invoices ───────── */

export const INVOICE_MAX_ITEMS = 10;
/** Per line and per invoice cap ($100,000), well inside PayPal's limits and int4 cents. */
const MAX_CENTS = 10_000_000;

/** "1,250.5" → 125050 cents. Rejects negatives, more than 2 decimals and junk. */
const moneyCents = (label: string) =>
  z
    .string({ error: `${label} is required.` })
    .trim()
    .transform((s) => s.replace(/[$,\s]/g, ""))
    .refine((s) => /^\d+(\.\d{1,2})?$/.test(s), `Enter ${label.toLowerCase()} like 150 or 150.00.`)
    .transform((s) => Math.round(Number(s) * 100))
    .refine((c) => c > 0, `${label} must be more than $0.`)
    .refine((c) => c <= MAX_CENTS, `${label} must be $100,000 or less.`);

const invoiceItemSchema = z.object({
  name: requiredText("Description", 200),
  quantity: z.coerce.number({ error: "Enter a quantity." }).int("Use a whole number.").min(1, "At least 1.").max(1000, "At most 1,000."),
  unitCents: moneyCents("Amount"),
});

/**
 * Form fields: title, dueDate, note, engagementId, and item{N}Name / item{N}Qty / item{N}Amount
 * for N = 0..9. Fully blank rows are ignored; field errors are keyed by the form field name.
 */
export function parseInvoiceInput(input: Record<string, unknown>) {
  // Collect header and line-item errors together so every problem shows at once.
  const fieldErrors: Record<string, string[]> = {};
  let head: { title: string; dueDate?: string; note?: string; engagementId?: string } | undefined;
  try {
    head = parseInput(
      z.object({
        title: requiredText("Invoice title", 200),
        dueDate: isoDate,
        note: optionalText(1000),
        engagementId: z.preprocess(blankToUndefined, uuid("engagement").optional()),
      }),
      input,
    );
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    Object.assign(fieldErrors, error.fieldErrors);
  }

  const items: { name: string; quantity: number; unitCents: number }[] = [];
  for (let i = 0; i < INVOICE_MAX_ITEMS; i++) {
    const raw = { name: input[`item${i}Name`], quantity: input[`item${i}Qty`], unitCents: input[`item${i}Amount`] };
    const blank = [raw.name, raw.unitCents].every((v) => v === undefined || (typeof v === "string" && v.trim() === ""));
    if (blank) continue;
    const r = invoiceItemSchema.safeParse({ ...raw, quantity: raw.quantity === undefined || raw.quantity === "" ? 1 : raw.quantity });
    if (r.success) items.push(r.data);
    else {
      const keys = { name: `item${i}Name`, quantity: `item${i}Qty`, unitCents: `item${i}Amount` } as const;
      for (const issue of r.error.issues) {
        const k = keys[issue.path[0] as keyof typeof keys];
        if (k) (fieldErrors[k] ??= []).push(issue.message);
      }
    }
  }
  if (!items.length && !Object.keys(fieldErrors).length) fieldErrors.item0Name = ["Add at least one line item."];
  const totalCents = items.reduce((s, i) => s + i.quantity * i.unitCents, 0);
  if (totalCents > MAX_CENTS) fieldErrors._form = ["The invoice total must be $100,000 or less."];
  if (Object.keys(fieldErrors).length || !head) throw new ValidationError(fieldErrors);
  return { ...head, items, totalCents };
}

export const subscriptionInputSchema = z.object({
  name: requiredText("Plan name", 120),
  amountCents: moneyCents("Amount"),
  interval: z.enum(["month", "year"], { error: "Choose monthly or yearly." }),
});
