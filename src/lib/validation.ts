import { z } from "zod";
import {
  appointmentKind,
  clientStatus,
  clientType,
  engagementStatus,
  leadSource,
  serviceType,
  taxChecklistStatus,
  taxFilingType,
  taxPreparationStatus,
} from "@/db/schema";
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

/** Checkbox groups arrive as an array (getAll) or a comma-separated string. */
const serviceList = z.preprocess(
  (v) => (Array.isArray(v) ? v : typeof v === "string" && v.trim() ? v.split(",").map((s) => s.trim()) : []),
  z.array(z.enum(serviceType.enumValues, { error: "Choose valid services." })).max(6),
);

/** A list of user ids (checkbox group / multi-select). */
const idList = (label: string) =>
  z.preprocess(
    (v) => (Array.isArray(v) ? v : typeof v === "string" && v.trim() ? v.split(",").map((s) => s.trim()) : []),
    z.array(z.uuid(`Choose a valid ${label}.`)).max(50),
  );

/** Optional money in dollars → integer cents. */
const optionalMoneyCents = z.preprocess(
  (v) => (typeof v === "string" ? v.replace(/[$,\s]/g, "") : v),
  z.preprocess(
    blankToUndefined,
    z
      .string()
      .regex(/^\d+(\.\d{1,2})?$/, "Enter an amount like 1500 or 1500.00.")
      .transform((s) => Math.round(Number(s) * 100))
      .refine((c) => c <= 100_000_000, "Must be $1,000,000 or less.")
      .optional(),
  ),
);

const priorityField = z.enum(["low", "normal", "high", "urgent"], { error: "Choose a priority." }).default("normal");

/** Optional whole hours (accepts "1.5") → minutes. */
const optionalHoursAsMinutes = z.preprocess(
  blankToUndefined,
  z.coerce.number({ error: "Enter hours, e.g. 1.5." }).min(0, "Can’t be negative.").max(10_000, "Too many hours.").transform((h) => Math.round(h * 60)).optional(),
);

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
  status: z.enum(clientStatus.enumValues).default("onboarding"),
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
  status: z.enum(engagementStatus.enumValues, { error: "Choose a status." }).optional(),
  /** The engagement manager. */
  ownerId: uuid("engagement manager"),
  dueDate: isoDate,
  description: optionalText(5000),
  periodStart: isoDate,
  periodEnd: isoDate,
  startDate: isoDate,
  staffIds: idList("staff member").default([]),
  feeCents: optionalMoneyCents,
  billingFrequency: z.preprocess(blankToUndefined, z.enum(["one_time", "monthly", "quarterly", "annually", "hourly"], { error: "Choose a billing arrangement." }).optional()),
  priority: priorityField,
  /** "not_required" = work may start right away; otherwise the proposal must be accepted first. */
  proposalStatus: z.enum(["not_required", "draft", "sent", "accepted", "declined"], { error: "Choose a proposal status." }).default("not_required"),
  acceptedOn: isoDate,
})
  .refine((d) => !d.startDate || !d.dueDate || d.startDate <= d.dueDate, { path: ["dueDate"], message: "The due date can’t be before the start date." })
  .refine((d) => !d.periodStart || !d.periodEnd || d.periodStart <= d.periodEnd, { path: ["periodEnd"], message: "The period must end after it starts." });
export type EngagementInput = z.infer<typeof engagementInputSchema>;

export const engagementTeamSchema = z.object({
  members: z
    .array(z.object({ userId: z.uuid("Choose a valid staff member."), role: z.enum(["manager", "staff", "reviewer"]) }))
    .max(50),
});

export const taskInputSchema = z
  .object({
    title: requiredText("Task", 300),
    description: optionalText(5000),
    isClientTask: checkbox,
    assigneeId: z.preprocess(blankToUndefined, uuid("assignee").optional()),
    priority: priorityField,
    startDate: isoDate,
    dueDate: isoDate,
    estimatedMinutes: optionalHoursAsMinutes,
    actualMinutes: optionalHoursAsMinutes,
    /** For standalone tasks (no engagement): the client it relates to. */
    clientId: z.preprocess(blankToUndefined, uuid("client").optional()),
    parentTaskId: z.preprocess(blankToUndefined, uuid("parent task").optional()),
    dependsOn: idList("task").default([]),
  })
  .refine((d) => !d.startDate || !d.dueDate || d.startDate <= d.dueDate, { path: ["dueDate"], message: "The due date can’t be before the start date." });
export type TaskInput = z.infer<typeof taskInputSchema>;

export const templateInputSchema = z.object({
  name: requiredText("Template name", 150),
  description: optionalText(1000),
  serviceType: z.enum(serviceType.enumValues, { error: "Choose a service." }),
  isActive: checkbox,
  steps: z
    .array(
      z.object({
        title: requiredText("Step", 300),
        description: optionalText(2000),
        defaultPriority: priorityField,
        relativeDueDays: z.preprocess(blankToUndefined, z.coerce.number().int("Whole days only.").min(0).max(730).optional()),
        defaultAssignee: z.enum(["manager", "staff", "reviewer", "unassigned"]).default("staff"),
        dependsOnSequence: z.preprocess(blankToUndefined, z.coerce.number().int().min(1).max(200).optional()),
        isClientTask: checkbox,
      }),
    )
    .min(1, "Add at least one step.")
    .max(100),
});

export const workflowGenerationSchema = z.object({
  templateId: uuid("template"),
  /** Optional per-step adjustments from the review screen, keyed by sequence. */
  overrides: z
    .array(z.object({ sequence: z.coerce.number().int().min(1), assigneeId: z.preprocess(blankToUndefined, uuid("assignee").optional()), dueDate: isoDate, skip: checkbox }))
    .max(200)
    .default([]),
});

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
  clientType: z.preprocess(blankToUndefined, z.enum(clientType.enumValues, { error: "Choose individual or business." }).optional()),
  address: optionalText(500),
  serviceInterest: optionalService,
  requestedServices: serviceList.default([]),
  source: z.enum(leadSource.enumValues, { error: "Choose a source." }).default("other"),
  priority: priorityField,
  estimatedValueCents: optionalMoneyCents,
  ownerId: z.preprocess(blankToUndefined, uuid("owner").optional()),
  followUpDate: isoDate,
  message: optionalText(2000),
});

/** Editing details. The stage is changed separately (setLeadStatus) so every move is recorded. */
export const leadUpdateSchema = leadInputSchema.extend({
  notes: optionalText(5000),
});

export const leadStatusChangeSchema = z
  .object({
    status: z.enum(["new", "contacted", "qualified", "consultation_scheduled", "proposal_sent", "negotiation", "lost", "nurture"], { error: "Choose a stage." }),
    lostReason: optionalText(500),
    note: optionalText(1000),
  })
  .refine((d) => d.status !== "lost" || !!d.lostReason, { path: ["lostReason"], message: "Say why the lead was lost." });

/** Notes, calls, emails and meetings on a lead/client/engagement/task timeline. */
export const activityInputSchema = z.object({
  type: z.enum(["note", "call", "email", "meeting", "comment", "internal_note"], { error: "Choose an activity type." }),
  body: requiredText("Details", 5000),
  occurredAt: z.preprocess(blankToUndefined, z.iso.datetime({ local: true, error: "Enter a valid date and time." }).optional()),
  followUpDate: isoDate,
});

/** Lead → client conversion. mode "existing" links to a client already in the CRM. */
export const leadConversionSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("existing"),
    clientId: uuid("client"),
  }),
  z.object({
    mode: z.literal("new"),
    type: z.enum(clientType.enumValues, { error: "Choose a client type." }),
    displayName: requiredText("Client name", 200),
    firstName: optionalText(100),
    lastName: optionalText(100),
    email: optionalEmail,
    phone: optionalPhone,
    address: optionalText(500),
    accountManagerId: z.preprocess(blankToUndefined, uuid("account manager").optional()),
    /** The user saw the possible-duplicate warning and chose to create a new client anyway. */
    confirmNotDuplicate: checkbox,
  }),
]);

export const clientDetailsSchema = clientInputSchema.extend({
  firstName: optionalText(100),
  lastName: optionalText(100),
  address: optionalText(500),
  accountManagerId: z.preprocess(blankToUndefined, uuid("account manager").optional()),
  notes: optionalText(5000),
});

export const contactInputSchema = z.object({
  name: requiredText("Name", 200),
  title: optionalText(120),
  role: z.enum(["owner", "primary", "billing", "authorized_representative", "other"], { error: "Choose a role." }).default("other"),
  email: optionalEmail,
  phone: optionalPhone,
  isPrimary: checkbox,
  notes: optionalText(1000),
});

export const onboardingItemSchema = z.object({
  title: requiredText("Item", 200),
  kind: z.enum(["information", "document"], { error: "Choose information or document." }).default("document"),
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

const taxServiceType = z.enum(["individual_tax", "business_tax"], { error: "Choose an individual or business tax service." });

export const taxPreparationInputSchema = z.object({
  clientId: uuid("client"),
  engagementId: z.preprocess(blankToUndefined, uuid("engagement").optional()),
  taxYear: z.coerce.number({ error: "Enter a tax year." }).int().min(2000).max(2100),
  taxPeriod: z.preprocess(blankToUndefined, requiredText("Tax period", 50)).default("annual"),
  jurisdiction: requiredText("Jurisdiction", 100),
  taxFormType: requiredText("Tax form", 100),
  filingType: z.enum(taxFilingType.enumValues).default("original"),
  returnSequence: z.coerce.number().int().min(1).max(100).default(1),
  serviceType: taxServiceType,
  preparerId: uuid("preparer"),
  reviewerId: z.preprocess(blankToUndefined, uuid("reviewer").optional()),
  dueDate: isoDate,
  internalNotes: optionalText(5000),
});

export const taxPreparationStatusSchema = z.object({
  status: z.enum(taxPreparationStatus.enumValues, { error: "Choose a preparation status." }),
});

export const taxChecklistUpdateSchema = z.object({
  status: z.enum(taxChecklistStatus.enumValues, { error: "Choose a checklist status." }),
  documentId: z.preprocess(blankToUndefined, uuid("document").optional()),
  notes: optionalText(2000),
});

export const taxDocumentTemplateInputSchema = z.object({
  name: requiredText("Document name", 200),
  description: optionalText(1000),
  taxpayerType: z.preprocess(blankToUndefined, z.enum(clientType.enumValues).optional()),
  serviceType: taxServiceType,
  jurisdiction: optionalText(100),
  taxYear: z.preprocess(blankToUndefined, z.coerce.number().int().min(2000).max(2100).optional()),
  required: checkbox,
});

export const taxReturnReviewNoteSchema = z.object({
  note: requiredText("Review note", 2000),
});

export const taxReturnPreparationDataSchema = z.object({
  refundAmount: optionalMoneyCents,
  amountOwed: optionalMoneyCents,
  internalNotes: optionalText(5000),
}).refine((data) => !(data.refundAmount !== undefined && data.amountOwed !== undefined), {
  path: ["refundAmount"],
  message: "Enter a refund or an amount owed, not both.",
}).transform(({ refundAmount, amountOwed, ...rest }) => ({
  ...rest,
  refundAmountCents: refundAmount,
  amountOwedCents: amountOwed,
}));

export const taxAuthorizationRecordSchema = z.object({
  outcome: z.enum(["authorized", "declined"], { error: "Choose an authorization outcome." }),
});

export const taxFilingRecordSchema = z.object({
  filingDate: z.preprocess(blankToUndefined, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
  }, "Enter a real filing date.")),
  submissionReference: requiredText("Submission reference", 200),
});

export const taxAuthorityResponseSchema = z.object({
  outcome: z.enum(["accepted", "rejected"], { error: "Choose an authority response." }),
  response: optionalText(2000),
});

export const staffRoleSchema = z.enum([
  "super_admin", "admin", "administrator", "operations_manager", "project_manager", "team_member",
  "sales_manager", "sales_representative", "finance_manager", "accountant", "marketing_manager",
  "account_manager", "support_agent", "developer", "manager", "employee", "read_only",
], { error: "Choose a role." });

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
/** Per line and per invoice cap ($100,000), within QuickBooks limits and int4 cents. */
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
