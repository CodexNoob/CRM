import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Data-handling rule: this milestone stores NO tax identifiers (SSN/EIN/ITIN),
 * bank or card data. Add such fields only with field-level encryption and a review.
 */

export const userRole = pgEnum("user_role", ["admin", "partner", "preparer", "client"]);
export const clientType = pgEnum("client_type", ["individual", "household", "business"]);
export const clientStatus = pgEnum("client_status", ["prospect", "active", "inactive"]);
export const serviceType = pgEnum("service_type", [
  "individual_tax",
  "business_tax",
  "tax_consulting",
  "bookkeeping",
  "accounting",
  "other",
]);
export const engagementStatus = pgEnum("engagement_status", [
  "not_started",
  "waiting_on_client",
  "in_progress",
  "in_review",
  "ready_to_file",
  "filed",
  "completed",
  "on_hold",
]);
export const taskStatus = pgEnum("task_status", ["open", "done"]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

/* ───────────────────────── Tenancy ───────────────────────── */

export const firmStatus = pgEnum("firm_status", ["trial", "active", "past_due", "cancelled"]);

/**
 * A subscribing firm (tenant). EVERY firm-owned row carries `firm_id`, and every
 * service query is limited to the signed-in actor's firm. Composite foreign keys
 * (firm_id, x_id) make it impossible at the database level to link a row to
 * another firm's client, engagement or staff member.
 */
export const firms = pgTable(
  "firms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    /** URL-safe handle for the firm's public page (/f/<slug>). */
    slug: text("slug").notNull(),
    status: firmStatus("status").notNull().default("trial"),
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
    /* The firm's subscription to this software (PayPal Subscriptions, paid to the operator). */
    billingInterval: text("billing_interval"), // "month" | "year"
    paypalSubscriptionId: text("paypal_subscription_id"),
    /** When PayPal will next charge (active subscriptions). */
    nextBillingAt: timestamp("next_billing_at", { withTimezone: true }),
    billingSyncedAt: timestamp("billing_synced_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex("firms_slug_unique").on(t.slug), uniqueIndex("firms_paypal_subscription_unique").on(t.paypalSubscriptionId)],
).enableRLS();

/** The operator's PayPal plans for selling this software (one per billing interval), created on first use. */
export const platformPlans = pgTable("platform_plans", {
  interval: text("interval").primaryKey(), // "month" | "year"
  amountCents: integer("amount_cents").notNull(),
  currency: text("currency").notNull(),
  paypalPlanId: text("paypal_plan_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

const firmId = () =>
  uuid("firm_id")
    .notNull()
    .references(() => firms.id, { onDelete: "restrict" });

export const clients = pgTable(
  "clients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: firmId(),
    type: clientType("type").notNull(),
    displayName: text("display_name").notNull(),
    email: text("email"),
    phone: text("phone"),
    status: clientStatus("status").notNull().default("active"),
    createdById: uuid("created_by_id").notNull(),
    ...timestamps,
  },
  (t) => [
    index("clients_display_name_idx").on(t.displayName),
    index("clients_firm_idx").on(t.firmId),
    // Target of the composite (firm_id, client_id) foreign keys below.
    unique("clients_firm_id_id_unique").on(t.firmId, t.id),
  ],
).enableRLS();

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: firmId(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    role: userRole("role").notNull(),
    /** Set only for role = 'client': the client record this portal login belongs to. */
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "restrict" }),
    /** argon2id hash; null until the user completes their invitation. */
    passwordHash: text("password_hash"),
    isActive: boolean("is_active").notNull().default(true),
    failedLoginCount: integer("failed_login_count").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    // One login per email across the whole service (a person signs in to exactly one firm).
    uniqueIndex("users_email_unique").on(sql`lower(${t.email})`),
    index("users_client_id_idx").on(t.clientId),
    index("users_firm_idx").on(t.firmId),
    unique("users_firm_id_id_unique").on(t.firmId, t.id),
    foreignKey({ name: "users_firm_client_fk", columns: [t.firmId, t.clientId], foreignColumns: [clients.firmId, clients.id] }),
  ],
).enableRLS();

export const sessions = pgTable(
  "sessions",
  {
    /** SHA-256 (hex) of the session token. The raw token exists only in the user's cookie. */
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
).enableRLS();

export const invitations = pgTable(
  "invitations",
  {
    /** SHA-256 (hex) of the one-time invitation token. */
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdById: uuid("created_by_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("invitations_user_id_idx").on(t.userId)],
).enableRLS();

/** Which staff members may work on which client (least privilege for preparers). */
export const clientAssignments = pgTable(
  "client_assignments",
  {
    firmId: firmId(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.clientId, t.userId] }),
    index("client_assignments_user_idx").on(t.userId),
    foreignKey({ name: "client_assignments_firm_client_fk", columns: [t.firmId, t.clientId], foreignColumns: [clients.firmId, clients.id] }),
    foreignKey({ name: "client_assignments_firm_user_fk", columns: [t.firmId, t.userId], foreignColumns: [users.firmId, users.id] }),
  ],
).enableRLS();

export const engagements = pgTable(
  "engagements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: firmId(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    serviceType: serviceType("service_type").notNull(),
    taxYear: integer("tax_year"),
    status: engagementStatus("status").notNull().default("not_started"),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    dueDate: date("due_date", { mode: "string" }),
    ...timestamps,
  },
  (t) => [
    index("engagements_client_idx").on(t.clientId),
    index("engagements_owner_idx").on(t.ownerId),
    index("engagements_due_idx").on(t.dueDate),
    index("engagements_firm_idx").on(t.firmId),
    unique("engagements_firm_id_id_unique").on(t.firmId, t.id),
    foreignKey({ name: "engagements_firm_client_fk", columns: [t.firmId, t.clientId], foreignColumns: [clients.firmId, clients.id] }),
    foreignKey({ name: "engagements_firm_owner_fk", columns: [t.firmId, t.ownerId], foreignColumns: [users.firmId, users.id] }),
  ],
).enableRLS();

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: firmId(),
    engagementId: uuid("engagement_id")
      .notNull()
      .references(() => engagements.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    /** Client-facing tasks are shown in the portal and can be completed by the client. */
    isClientTask: boolean("is_client_task").notNull().default(false),
    /** Staff assignee for internal tasks. */
    assigneeId: uuid("assignee_id").references(() => users.id, { onDelete: "set null" }),
    status: taskStatus("status").notNull().default("open"),
    dueDate: date("due_date", { mode: "string" }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedById: uuid("completed_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    index("tasks_engagement_idx").on(t.engagementId),
    index("tasks_firm_idx").on(t.firmId),
    foreignKey({ name: "tasks_firm_engagement_fk", columns: [t.firmId, t.engagementId], foreignColumns: [engagements.firmId, engagements.id] }),
    foreignKey({ name: "tasks_firm_assignee_fk", columns: [t.firmId, t.assigneeId], foreignColumns: [users.firmId, users.id] }),
  ],
).enableRLS();

/**
 * Append-only audit trail. `metadata` must never hold sensitive values:
 * record field NAMES that changed, not their contents.
 */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The firm the event belongs to. Null only for service-level (platform) events. */
    firmId: uuid("firm_id").references(() => firms.id, { onDelete: "restrict" }),
    actorUserId: uuid("actor_user_id"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_entity_idx").on(t.entityType, t.entityId), index("audit_created_idx").on(t.createdAt), index("audit_firm_created_idx").on(t.firmId, t.createdAt)],
).enableRLS();

/* ───────────────────────── Phase 1: leads, documents, messages, calendar ───────────────────────── */

export const leadStatus = pgEnum("lead_status", ["new", "contacted", "qualified", "converted", "lost"]);
export const leadSource = pgEnum("lead_source", ["website", "referral", "phone", "walk_in", "other"]);

export const leads = pgTable(
  "leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: firmId(),
    name: text("name").notNull(),
    email: text("email"),
    phone: text("phone"),
    company: text("company"),
    serviceInterest: serviceType("service_interest"),
    source: leadSource("source").notNull().default("other"),
    status: leadStatus("status").notNull().default("new"),
    /** The prospect's own words from the inquiry form. Treated as untrusted text. */
    message: text("message"),
    /** Internal staff notes. */
    notes: text("notes"),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    followUpDate: date("follow_up_date", { mode: "string" }),
    convertedClientId: uuid("converted_client_id").references(() => clients.id, { onDelete: "set null" }),
    /** When the prospect agreed to be contacted (website form). */
    consentAt: timestamp("consent_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("leads_status_idx").on(t.status),
    index("leads_owner_idx").on(t.ownerId),
    index("leads_firm_idx").on(t.firmId),
    foreignKey({ name: "leads_firm_owner_fk", columns: [t.firmId, t.ownerId], foreignColumns: [users.firmId, users.id] }),
    foreignKey({ name: "leads_firm_client_fk", columns: [t.firmId, t.convertedClientId], foreignColumns: [clients.firmId, clients.id] }),
  ],
).enableRLS();

export const scanStatus = pgEnum("scan_status", ["not_scanned", "pending", "clean", "infected"]);

/** Document metadata. The bytes live in `document_blobs` (or external storage) so listings never load file contents. */
export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: firmId(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "restrict" }),
    engagementId: uuid("engagement_id").references(() => engagements.id, { onDelete: "set null" }),
    fileName: text("file_name").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    storageKey: text("storage_key").notNull(),
    uploadedById: uuid("uploaded_by_id").references(() => users.id, { onDelete: "set null" }),
    uploadedByClient: boolean("uploaded_by_client").notNull().default(false),
    visibleToClient: boolean("visible_to_client").notNull().default(false),
    scanStatus: scanStatus("scan_status").notNull().default("not_scanned"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("documents_client_idx").on(t.clientId),
    index("documents_engagement_idx").on(t.engagementId),
    index("documents_firm_idx").on(t.firmId),
    foreignKey({ name: "documents_firm_client_fk", columns: [t.firmId, t.clientId], foreignColumns: [clients.firmId, clients.id] }),
    foreignKey({ name: "documents_firm_engagement_fk", columns: [t.firmId, t.engagementId], foreignColumns: [engagements.firmId, engagements.id] }),
  ],
).enableRLS();

const bytea = customType<{ data: Buffer; driverData: Buffer | Uint8Array }>({
  dataType: () => "bytea",
  fromDriver: (v) => (Buffer.isBuffer(v) ? v : Buffer.from(v)),
});

/** Database-backed file storage (pilot). Encrypted at rest with the rest of the database. */
export const documentBlobs = pgTable("document_blobs", {
  storageKey: text("storage_key").primaryKey(),
  data: bytea("data").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

/** One conversation per client between the firm and the client's portal users. */
export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: firmId(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "restrict" }),
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    fromClient: boolean("from_client").notNull(),
    body: text("body").notNull(),
    /** When the other side (staff for client messages, the client for staff messages) first read it. */
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("messages_client_idx").on(t.clientId, t.createdAt),
    index("messages_firm_idx").on(t.firmId),
    foreignKey({ name: "messages_firm_client_fk", columns: [t.firmId, t.clientId], foreignColumns: [clients.firmId, clients.id] }),
  ],
).enableRLS();

export const appointmentKind = pgEnum("appointment_kind", ["in_person", "phone", "video", "internal"]);

export const appointments = pgTable(
  "appointments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: firmId(),
    title: text("title").notNull(),
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "set null" }),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    kind: appointmentKind("kind").notNull().default("in_person"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    location: text("location"),
    notes: text("notes"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    index("appointments_starts_idx").on(t.startsAt),
    index("appointments_client_idx").on(t.clientId),
    index("appointments_firm_idx").on(t.firmId, t.startsAt),
    foreignKey({ name: "appointments_firm_client_fk", columns: [t.firmId, t.clientId], foreignColumns: [clients.firmId, clients.id] }),
    foreignKey({ name: "appointments_firm_owner_fk", columns: [t.firmId, t.ownerId], foreignColumns: [users.firmId, users.id] }),
  ],
).enableRLS();

/* ───────────────────────── Firm settings (drive the public website) ───────────────────────── */

/** One row per firm holding its public details (shown on the firm's public page). */
export const firmProfile = pgTable("firm_profile", {
  firmId: uuid("firm_id")
    .primaryKey()
    .references(() => firms.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  phone: text("phone"),
  email: text("email"),
  addressLine1: text("address_line1"),
  addressLine2: text("address_line2"),
  hours: jsonb("hours").$type<[string, string][]>(),
  tagline: text("tagline"),
  updatedById: uuid("updated_by_id").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

export const announcements = pgTable(
  "announcements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: firmId(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    publishedOn: date("published_on", { mode: "string" }).notNull(),
    isPublished: boolean("is_published").notNull().default(true),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [index("announcements_published_idx").on(t.isPublished, t.publishedOn), index("announcements_firm_idx").on(t.firmId)],
).enableRLS();

/* ───────────────────────── Invoices (PayPal is the system of record) ───────────────────────── */

export const invoiceStatus = pgEnum("invoice_status", ["draft", "sent", "partially_paid", "paid", "cancelled", "refunded"]);

/**
 * The CRM's linked copy of an invoice that lives in PayPal. PayPal emails it,
 * hosts the payment page and holds the payment records; status is refreshed from PayPal.
 * Amounts are integer cents. No card or bank data is ever stored here.
 */
export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: firmId(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "restrict" }),
    engagementId: uuid("engagement_id").references(() => engagements.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    items: jsonb("items").$type<{ name: string; quantity: number; unitCents: number }[]>().notNull(),
    currency: text("currency").notNull().default("USD"),
    totalCents: integer("total_cents").notNull(),
    paidCents: integer("paid_cents").notNull().default(0),
    dueDate: date("due_date", { mode: "string" }),
    note: text("note"),
    status: invoiceStatus("status").notNull().default("draft"),
    /** Email the invoice was sent to (snapshot of the client's email at send time). */
    recipientEmail: text("recipient_email").notNull(),
    paypalInvoiceId: text("paypal_invoice_id"),
    paypalInvoiceNumber: text("paypal_invoice_number"),
    /** PayPal-hosted page where the client pays. */
    payUrl: text("pay_url"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    syncedAt: timestamp("synced_at", { withTimezone: true }),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    index("invoices_client_idx").on(t.clientId, t.createdAt),
    index("invoices_status_idx").on(t.status),
    uniqueIndex("invoices_paypal_id_unique").on(t.paypalInvoiceId),
    index("invoices_firm_idx").on(t.firmId),
    foreignKey({ name: "invoices_firm_client_fk", columns: [t.firmId, t.clientId], foreignColumns: [clients.firmId, clients.id] }),
    foreignKey({ name: "invoices_firm_engagement_fk", columns: [t.firmId, t.engagementId], foreignColumns: [engagements.firmId, engagements.id] }),
  ],
).enableRLS();

export const subscriptionStatus = pgEnum("subscription_status", ["pending", "active", "suspended", "cancelled", "expired"]);
export const billingInterval = pgEnum("billing_interval", ["month", "year"]);

/**
 * Recurring billing (monthly or yearly) through PayPal Subscriptions.
 * Staff create the plan; the client clicks "Subscribe" in the portal and approves it in PayPal,
 * which then charges automatically each period. PayPal holds the payment method.
 */
export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: firmId(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("USD"),
    interval: billingInterval("interval").notNull(),
    status: subscriptionStatus("status").notNull().default("pending"),
    paypalPlanId: text("paypal_plan_id").notNull(),
    /** Set when the client starts checkout; replaced if they abandon and start again. */
    paypalSubscriptionId: text("paypal_subscription_id"),
    nextBillingAt: timestamp("next_billing_at", { withTimezone: true }),
    lastPaymentAt: timestamp("last_payment_at", { withTimezone: true }),
    lastPaymentCents: integer("last_payment_cents"),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    syncedAt: timestamp("synced_at", { withTimezone: true }),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    index("subscriptions_client_idx").on(t.clientId, t.createdAt),
    uniqueIndex("subscriptions_paypal_id_unique").on(t.paypalSubscriptionId),
    index("subscriptions_firm_idx").on(t.firmId),
    foreignKey({ name: "subscriptions_firm_client_fk", columns: [t.firmId, t.clientId], foreignColumns: [clients.firmId, clients.id] }),
  ],
).enableRLS();

export type User = typeof users.$inferSelect;
export type Firm = typeof firms.$inferSelect;
export type FirmStatus = (typeof firmStatus.enumValues)[number];
export type Subscription = typeof subscriptions.$inferSelect;
export type SubscriptionStatus = (typeof subscriptionStatus.enumValues)[number];
export type BillingInterval = (typeof billingInterval.enumValues)[number];
export type Invoice = typeof invoices.$inferSelect;
export type InvoiceStatus = (typeof invoiceStatus.enumValues)[number];
export type Lead = typeof leads.$inferSelect;
export type LeadStatus = (typeof leadStatus.enumValues)[number];
export type LeadSource = (typeof leadSource.enumValues)[number];
export type DocumentRow = typeof documents.$inferSelect;
export type Appointment = typeof appointments.$inferSelect;
export type AppointmentKind = (typeof appointmentKind.enumValues)[number];
export type Client = typeof clients.$inferSelect;
export type Engagement = typeof engagements.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type UserRole = (typeof userRole.enumValues)[number];
export type EngagementStatus = (typeof engagementStatus.enumValues)[number];
export type ServiceType = (typeof serviceType.enumValues)[number];
export type ClientType = (typeof clientType.enumValues)[number];
export type ClientStatus = (typeof clientStatus.enumValues)[number];
