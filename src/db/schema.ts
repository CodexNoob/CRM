import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  date,
  foreignKey,
  index,
  type AnyPgColumn,
  type PgTableExtraConfigValue,
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

/**
 * Roles. admin: everything in the firm. manager: all firm records + approvals (formerly "partner").
 * employee: assigned clients/work (formerly "preparer"). read_only: view all firm records, change nothing.
 * client: portal only.
 */
export const userRole = pgEnum("user_role", ["super_admin", "admin", "manager", "employee", "read_only", "client"]);
export const clientType = pgEnum("client_type", ["individual", "household", "business"]);
export const clientStatus = pgEnum("client_status", ["prospect", "onboarding", "active", "inactive", "on_hold", "former"]);
export const onboardingStatus = pgEnum("onboarding_status", ["not_started", "information_requested", "awaiting_documents", "under_verification", "completed"]);
export const priority = pgEnum("priority", ["low", "normal", "high", "urgent"]);
export const serviceType = pgEnum("service_type", [
  "individual_tax",
  "business_tax",
  "tax_consulting",
  "bookkeeping",
  "accounting",
  "other",
]);
/**
 * Engagement lifecycle. draft → proposal_sent → awaiting_acceptance → active, then work
 * stages (not_started … in_review [Under Review] … filed/completed), then closed.
 * The tax-specific work stages (waiting_on_client, ready_to_file, filed) power the Tax pages and portal.
 */
export const engagementStatus = pgEnum("engagement_status", [
  "draft",
  "proposal_sent",
  "awaiting_acceptance",
  "active",
  "not_started",
  "waiting_on_client",
  "in_progress",
  "in_review",
  "ready_to_file",
  "filed",
  "completed",
  "on_hold",
  "cancelled",
  "closed",
]);
/** Kept separate from work progress: has the client accepted the scope and fee? */
export const proposalStatus = pgEnum("proposal_status", ["not_required", "draft", "sent", "accepted", "declined"]);
export const billingFrequency = pgEnum("billing_frequency", ["one_time", "monthly", "quarterly", "annually", "hourly"]);
export const taskStatus = pgEnum("task_status", ["todo", "in_progress", "waiting_client", "waiting_review", "blocked", "completed", "cancelled"]);
export const taxPreparationStatus = pgEnum("tax_preparation_status", [
  "not_started",
  "documents_requested",
  "awaiting_documents",
  "documents_received",
  "verification",
  "ready_for_preparation",
  "in_preparation",
  "internal_review",
  "changes_required",
  "completed",
]);
export const taxChecklistStatus = pgEnum("tax_checklist_status", [
  "not_requested",
  "requested",
  "received",
  "under_review",
  "verified",
  "rejected",
  "not_applicable",
]);
export const taxReturnStatus = pgEnum("tax_return_status", [
  "not_started",
  "waiting_for_documents",
  "in_preparation",
  "ready_for_review",
  "under_review",
  "changes_required",
  "awaiting_client_approval",
  "approved",
  "filed",
  "accepted",
  "rejected",
  "amended",
]);
export const taxFilingType = pgEnum("tax_filing_type", ["original", "amended"]);
export const taxReviewStatus = pgEnum("tax_review_status", ["not_started", "pending", "changes_required", "approved"]);
export const taxAuthorizationStatus = pgEnum("tax_authorization_status", ["not_requested", "requested", "authorized", "declined"]);
export const taxFilingStatus = pgEnum("tax_filing_status", ["not_filed", "filed", "accepted", "rejected"]);
export const taxAuthorityStatus = pgEnum("tax_authority_status", ["pending", "accepted", "rejected"]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

const bytea = customType<{ data: Buffer; driverData: Buffer | Uint8Array }>({
  dataType: () => "bytea",
  fromDriver: (v) => (Buffer.isBuffer(v) ? v : Buffer.from(v)),
});

/* ───────────────────────── Tenancy ───────────────────────── */

export const firmStatus = pgEnum("firm_status", ["trial", "active", "past_due", "cancelled"]);
export const qboConnectionScope = pgEnum("qbo_connection_scope", ["firm"]);
export const qboConnectionStatus = pgEnum("qbo_connection_status", ["connected", "reauthorization_required"]);

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
    /** URL-safe tenant handle retained for internal/future integrations. */
    slug: text("slug").notNull(),
    status: firmStatus("status").notNull().default("trial"),
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
    /* The firm's subscription to this software, billed by the platform operator. */
    billingInterval: text("billing_interval"), // "month" | "year"
    paypalSubscriptionId: text("paypal_subscription_id"),
    paypalCheckoutRequestId: text("paypal_checkout_request_id"),
    legacyExternalSubscriptionId: text("legacy_external_subscription_id"),
    nextBillingAt: timestamp("next_billing_at", { withTimezone: true }),
    billingSyncedAt: timestamp("billing_synced_at", { withTimezone: true }),
    paypalLastEventAt: timestamp("paypal_last_event_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("firms_slug_unique").on(t.slug),
    uniqueIndex("firms_paypal_subscription_unique").on(t.paypalSubscriptionId),
    uniqueIndex("firms_paypal_checkout_request_unique").on(t.paypalCheckoutRequestId),
    uniqueIndex("firms_legacy_subscription_unique").on(t.legacyExternalSubscriptionId),
  ],
).enableRLS();

export const qboConnections = pgTable(
  "qbo_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scope: qboConnectionScope("scope").notNull(),
    firmId: uuid("firm_id").notNull().references(() => firms.id, { onDelete: "cascade" }),
    realmId: text("realm_id").notNull(),
    companyName: text("company_name").notNull(),
    accessTokenEncrypted: text("access_token_encrypted").notNull(),
    refreshTokenEncrypted: text("refresh_token_encrypted").notNull(),
    accessExpiresAt: timestamp("access_expires_at", { withTimezone: true }).notNull(),
    refreshExpiresAt: timestamp("refresh_expires_at", { withTimezone: true }).notNull(),
    status: qboConnectionStatus("status").notNull().default("connected"),
    defaultItemId: text("default_item_id"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    connectedById: uuid("connected_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("qbo_connections_firm_unique").on(t.firmId),
    check("qbo_connections_scope_firm_check", sql`${t.scope} = 'firm'`),
  ],
).enableRLS();

export const qboOAuthStates = pgTable(
  "qbo_oauth_states",
  {
    stateHash: text("state_hash").primaryKey(),
    scope: qboConnectionScope("scope").notNull(),
    firmId: uuid("firm_id").notNull().references(() => firms.id, { onDelete: "cascade" }),
    createdById: uuid("created_by_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("qbo_oauth_states_scope_firm_check", sql`${t.scope} = 'firm'`),
  ],
).enableRLS();

/** Singleton platform-owned identity; never tied to a subscribing firm's tenant record. */
export const platformSettings = pgTable("platform_settings", {
  id: text("id").primaryKey().default("default"),
  name: text("name").notNull().default("CRM Platform"),
  description: text("description"),
  websiteUrl: text("website_url"),
  officialEmail: text("official_email"),
  phone: text("phone"),
  addressLine1: text("address_line1"),
  addressLine2: text("address_line2"),
  salesEmail: text("sales_email"),
  supportEmail: text("support_email"),
  supportPhone: text("support_phone"),
  logoData: bytea("logo_data"),
  logoContentType: text("logo_content_type"),
  updatedById: uuid("updated_by_id").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

/** Contact requests for the CRM operator; intentionally not firm leads and not tenant-scoped. */
export const platformInquiries = pgTable(
  "platform_inquiries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    phone: text("phone"),
    topic: text("topic").notNull(),
    message: text("message").notNull(),
    status: text("status").notNull().default("new"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("platform_inquiries_created_idx").on(t.createdAt)],
).enableRLS();

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
    /** Per-firm sequence shown as C-0001. */
    clientNumber: integer("client_number"),
    /** Individuals: name parts (display_name stays the canonical name used everywhere). */
    firstName: text("first_name"),
    lastName: text("last_name"),
    address: text("address"),
    // Explicit return type breaks the clients ↔ users type cycle (users.client_id references clients).
    accountManagerId: uuid("account_manager_id").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
    onboardingStatus: onboardingStatus("onboarding_status").notNull().default("not_started"),
    /** The lead this client was converted from (if any). */
    sourceLeadId: uuid("source_lead_id"),
    notes: text("notes"),
    /** Soft archive: hidden from default lists, never deleted. */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdById: uuid("created_by_id").notNull(),
    ...timestamps,
  },
  (t): PgTableExtraConfigValue[] => [
    index("clients_display_name_idx").on(t.displayName),
    uniqueIndex("clients_firm_number_unique").on(t.firmId, t.clientNumber),
    index("clients_account_manager_idx").on(t.accountManagerId),
    index("clients_firm_idx").on(t.firmId),
    // Target of the composite (firm_id, client_id) foreign keys below.
    unique("clients_firm_id_id_unique").on(t.firmId, t.id),
    // The account manager must be a member of the same firm (users is defined below; resolved lazily).
    foreignKey({ name: "clients_firm_account_manager_fk", columns: [t.firmId, t.accountManagerId], foreignColumns: [users.firmId as AnyPgColumn, users.id as AnyPgColumn] }),
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
    clientId: uuid("client_id").references((): AnyPgColumn => clients.id, { onDelete: "restrict" }),
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

/** Single-use, hashed tokens for self-service account password recovery. */
export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("password_reset_tokens_expires_idx").on(t.expiresAt)],
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
    /** The engagement manager. */
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    dueDate: date("due_date", { mode: "string" }),
    /** Per-firm sequence shown as E-0001. */
    engagementNumber: integer("engagement_number"),
    /** Scope of work. */
    description: text("description"),
    periodStart: date("period_start", { mode: "string" }),
    periodEnd: date("period_end", { mode: "string" }),
    startDate: date("start_date", { mode: "string" }),
    feeCents: integer("fee_cents"),
    billingFrequency: billingFrequency("billing_frequency"),
    priority: priority("priority").notNull().default("normal"),
    proposalStatus: proposalStatus("proposal_status").notNull().default("not_required"),
    acceptedOn: date("accepted_on", { mode: "string" }),
    /** A manager allowed work to start before the proposal was accepted. */
    workOverrideById: uuid("work_override_by_id").references(() => users.id, { onDelete: "set null" }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    index("engagements_client_idx").on(t.clientId),
    uniqueIndex("engagements_firm_number_unique").on(t.firmId, t.engagementNumber),
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
    /** Optional: tasks may belong to a client without an engagement (e.g. onboarding), or to neither (internal). */
    engagementId: uuid("engagement_id").references(() => engagements.id, { onDelete: "cascade" }),
    /** Always set when the task relates to a client (derived from the engagement when there is one). */
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "restrict" }),
    /** Per-firm sequence shown as T-0001. */
    taskNumber: integer("task_number"),
    title: text("title").notNull(),
    description: text("description"),
    /** Client-facing tasks are shown in the portal and can be completed by the client. */
    isClientTask: boolean("is_client_task").notNull().default(false),
    /** Staff assignee for internal tasks. */
    assigneeId: uuid("assignee_id").references(() => users.id, { onDelete: "set null" }),
    assignedById: uuid("assigned_by_id").references(() => users.id, { onDelete: "set null" }),
    status: taskStatus("status").notNull().default("todo"),
    priority: priority("priority").notNull().default("normal"),
    startDate: date("start_date", { mode: "string" }),
    dueDate: date("due_date", { mode: "string" }),
    estimatedMinutes: integer("estimated_minutes"),
    actualMinutes: integer("actual_minutes"),
    parentTaskId: uuid("parent_task_id"),
    workflowInstanceId: uuid("workflow_instance_id"),
    /** Order within a generated workflow. */
    sequence: integer("sequence"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedById: uuid("completed_by_id").references(() => users.id, { onDelete: "set null" }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("tasks_engagement_idx").on(t.engagementId),
    index("tasks_client_idx").on(t.clientId),
    index("tasks_assignee_status_idx").on(t.assigneeId, t.status),
    index("tasks_firm_idx").on(t.firmId),
    uniqueIndex("tasks_firm_number_unique").on(t.firmId, t.taskNumber),
    unique("tasks_firm_id_id_unique").on(t.firmId, t.id),
    foreignKey({ name: "tasks_firm_engagement_fk", columns: [t.firmId, t.engagementId], foreignColumns: [engagements.firmId, engagements.id] }),
    foreignKey({ name: "tasks_firm_client_fk", columns: [t.firmId, t.clientId], foreignColumns: [clients.firmId, clients.id] }),
    foreignKey({ name: "tasks_firm_assignee_fk", columns: [t.firmId, t.assigneeId], foreignColumns: [users.firmId, users.id] }),
    foreignKey({ name: "tasks_firm_parent_fk", columns: [t.firmId, t.parentTaskId], foreignColumns: [t.firmId, t.id] }),
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

/** Pipeline stages. "converted" is shown as "Won / Converted". */
export const leadStatus = pgEnum("lead_status", ["new", "contacted", "qualified", "consultation_scheduled", "proposal_sent", "negotiation", "converted", "lost", "nurture"]);
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
    /** Per-firm sequence shown as L-0001. */
    leadNumber: integer("lead_number"),
    clientType: clientType("client_type"),
    address: text("address"),
    /** All services the prospect asked about (service_interest holds the first, for older screens). */
    requestedServices: serviceType("requested_services").array(),
    estimatedValueCents: integer("estimated_value_cents"),
    priority: priority("priority").notNull().default("normal"),
    lastContactedAt: timestamp("last_contacted_at", { withTimezone: true }),
    lostReason: text("lost_reason"),
    convertedAt: timestamp("converted_at", { withTimezone: true }),
    convertedById: uuid("converted_by_id").references(() => users.id, { onDelete: "set null" }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("leads_status_idx").on(t.status),
    uniqueIndex("leads_firm_number_unique").on(t.firmId, t.leadNumber),
    index("leads_follow_up_idx").on(t.firmId, t.followUpDate),
    index("leads_owner_idx").on(t.ownerId),
    index("leads_firm_idx").on(t.firmId),
    foreignKey({ name: "leads_firm_owner_fk", columns: [t.firmId, t.ownerId], foreignColumns: [users.firmId, users.id] }),
    foreignKey({ name: "leads_firm_client_fk", columns: [t.firmId, t.convertedClientId], foreignColumns: [clients.firmId, clients.id] }),
  ],
).enableRLS();

export const scanStatus = pgEnum("scan_status", ["not_scanned", "pending", "clean", "infected"]);
export const documentCategory = pgEnum("document_category", [
  "tax_documents",
  "income_statements",
  "bank_statements",
  "financial_reports",
  "expense_receipts",
  "invoices",
  "contracts",
  "engagement_letters",
  "tax_returns",
  "identity_documents",
  "payroll_documents",
  "bookkeeping_records",
  "other",
]);
/** requested is used by placeholder rows only; uploads start at uploaded / under_review — never verified. */
export const documentStatus = pgEnum("document_status", ["requested", "uploaded", "under_review", "verified", "rejected", "replacement_requested", "archived"]);
/** internal_only: staff only (default). client_visible: the client sees it in the portal. shared_with_client: staff deliberately sent it. */
export const documentVisibility = pgEnum("document_visibility", ["internal_only", "client_visible", "shared_with_client"]);

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
    /** Attachment to a task (optional). */
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    fileName: text("file_name").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    storageKey: text("storage_key").notNull(),
    uploadedById: uuid("uploaded_by_id").references(() => users.id, { onDelete: "set null" }),
    uploadedByClient: boolean("uploaded_by_client").notNull().default(false),
    /** Kept in sync with `visibility` (true unless internal_only) for older queries. */
    visibleToClient: boolean("visible_to_client").notNull().default(false),
    scanStatus: scanStatus("scan_status").notNull().default("not_scanned"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /* ── Document management (collaboration) ── */
    /** Per-firm sequence shown as D-0001 (shared by every version of one document). */
    documentNumber: integer("document_number"),
    /** Display name chosen by staff; defaults to the original file name. */
    title: text("title"),
    category: documentCategory("category").notNull().default("other"),
    status: documentStatus("status").notNull().default("uploaded"),
    visibility: documentVisibility("visibility").notNull().default("internal_only"),
    versionNumber: integer("version_number").notNull().default(1),
    /** First version of this document (null on the first version itself). */
    rootDocumentId: uuid("root_document_id"),
    /** The version this one replaced. */
    previousVersionId: uuid("previous_version_id"),
    /** False once a newer version exists. */
    isCurrentVersion: boolean("is_current_version").notNull().default(true),
    taxPreparationCaseId: uuid("tax_preparation_case_id"),
    taxReturnId: uuid("tax_return_id"),
    documentRequestItemId: uuid("document_request_item_id"),
    reviewedById: uuid("reviewed_by_id").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    /** Shown to the client when a replacement is requested. */
    reviewNote: text("review_note"),
    expirationDate: date("expiration_date", { mode: "string" }),
    description: text("description"),
    /** Staff-only. Never returned by portal queries. */
    internalNotes: text("internal_notes"),
    /** Tax year the document relates to (for filtering). */
    taxYear: integer("tax_year"),
    /** "database" (document_blobs) or "supabase" (private bucket). */
    storageProvider: text("storage_provider").notNull().default("database"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t): PgTableExtraConfigValue[] => [
    index("documents_client_idx").on(t.clientId),
    index("documents_root_idx").on(t.rootDocumentId),
    index("documents_firm_status_idx").on(t.firmId, t.status),
    uniqueIndex("documents_firm_number_version_unique").on(t.firmId, t.documentNumber, t.versionNumber),
    index("documents_engagement_idx").on(t.engagementId),
    index("documents_firm_idx").on(t.firmId),
    unique("documents_firm_id_id_unique").on(t.firmId, t.id),
    foreignKey({ name: "documents_firm_client_fk", columns: [t.firmId, t.clientId], foreignColumns: [clients.firmId, clients.id] }),
    foreignKey({ name: "documents_firm_engagement_fk", columns: [t.firmId, t.engagementId], foreignColumns: [engagements.firmId, engagements.id] }),
    foreignKey({ name: "documents_firm_task_fk", columns: [t.firmId, t.taskId], foreignColumns: [tasks.firmId, tasks.id] }),
    // Tables defined further down (resolved lazily; typed loosely to avoid inference cycles).
    foreignKey({ name: "documents_firm_tax_case_fk", columns: [t.firmId, t.taxPreparationCaseId], foreignColumns: [taxPreparationCases.firmId as AnyPgColumn, taxPreparationCases.id as AnyPgColumn] }),
    foreignKey({ name: "documents_firm_tax_return_fk", columns: [t.firmId, t.taxReturnId], foreignColumns: [taxReturns.firmId as AnyPgColumn, taxReturns.id as AnyPgColumn] }),
    foreignKey({ name: "documents_firm_request_item_fk", columns: [t.firmId, t.documentRequestItemId], foreignColumns: [documentRequestItems.firmId as AnyPgColumn, documentRequestItems.id as AnyPgColumn] }),
    foreignKey({ name: "documents_firm_root_fk", columns: [t.firmId, t.rootDocumentId], foreignColumns: [t.firmId, t.id] }),
    foreignKey({ name: "documents_firm_previous_fk", columns: [t.firmId, t.previousVersionId], foreignColumns: [t.firmId, t.id] }),
    index("documents_task_idx").on(t.taskId),
  ],
).enableRLS();

/** Database-backed file storage (pilot). Encrypted at rest with the rest of the database. */
export const documentBlobs = pgTable("document_blobs", {
  storageKey: text("storage_key").primaryKey(),
  data: bytea("data").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

export const conversationCategory = pgEnum("conversation_category", [
  "general_inquiry",
  "document_request",
  "tax_preparation",
  "tax_return",
  "bookkeeping",
  "billing",
  "appointment",
  "engagement",
  "other",
]);
export const conversationStatus = pgEnum("conversation_status", ["open", "waiting_for_client", "waiting_for_staff", "in_progress", "resolved", "closed"]);

/** A conversation between the firm and one client (many per client). */
export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: firmId(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "restrict" }),
    conversationNumber: integer("conversation_number"),
    subject: text("subject").notNull(),
    category: conversationCategory("category").notNull().default("general_inquiry"),
    status: conversationStatus("status").notNull().default("open"),
    priority: priority("priority").notNull().default("normal"),
    engagementId: uuid("engagement_id").references(() => engagements.id, { onDelete: "set null" }),
    taxReturnId: uuid("tax_return_id"),
    assignedStaffId: uuid("assigned_staff_id").references(() => users.id, { onDelete: "set null" }),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    /** Last client-visible message (drives the inbox order). */
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (t): PgTableExtraConfigValue[] => [
    index("conversations_client_idx").on(t.clientId, t.lastMessageAt),
    index("conversations_firm_status_idx").on(t.firmId, t.status, t.lastMessageAt),
    index("conversations_assigned_idx").on(t.assignedStaffId),
    uniqueIndex("conversations_firm_number_unique").on(t.firmId, t.conversationNumber),
    unique("conversations_firm_id_id_unique").on(t.firmId, t.id),
    foreignKey({ name: "conversations_firm_client_fk", columns: [t.firmId, t.clientId], foreignColumns: [clients.firmId, clients.id] }),
    foreignKey({ name: "conversations_firm_engagement_fk", columns: [t.firmId, t.engagementId], foreignColumns: [engagements.firmId, engagements.id] }),
    foreignKey({ name: "conversations_firm_assignee_fk", columns: [t.firmId, t.assignedStaffId], foreignColumns: [users.firmId, users.id] }),
    foreignKey({ name: "conversations_firm_tax_return_fk", columns: [t.firmId, t.taxReturnId], foreignColumns: [taxReturns.firmId as AnyPgColumn, taxReturns.id as AnyPgColumn] }),
  ],
).enableRLS();

/** Messages within a conversation. Internal notes are staff-only and never returned to portal users. */
export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: firmId(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "restrict" }),
    conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "cascade" }),
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    fromClient: boolean("from_client").notNull(),
    body: text("body").notNull(),
    /** Staff-only note inside a conversation. */
    isInternal: boolean("is_internal").notNull().default(false),
    /** "message" | "internal_note" | "system" */
    messageType: text("message_type").notNull().default("message"),
    /** When the other side (staff for client messages, the client for staff messages) first read it. */
    readAt: timestamp("read_at", { withTimezone: true }),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("messages_client_idx").on(t.clientId, t.createdAt),
    index("messages_conversation_idx").on(t.conversationId, t.createdAt),
    index("messages_firm_idx").on(t.firmId),
    unique("messages_firm_id_id_unique").on(t.firmId, t.id),
    foreignKey({ name: "messages_firm_client_fk", columns: [t.firmId, t.clientId], foreignColumns: [clients.firmId, clients.id] }),
    foreignKey({ name: "messages_firm_conversation_fk", columns: [t.firmId, t.conversationId], foreignColumns: [conversations.firmId, conversations.id] }),
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

/* ───────────────────────── Tenant organization profile ───────────────────────── */

/** Private organization details used in the firm's workspace and business operations. */
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
  websiteUrl: text("website_url"),
  description: text("description"),
  socialLinks: jsonb("social_links").$type<{ label: string; url: string }[]>(),
  timeZone: text("time_zone").notNull().default("America/New_York"),
  locale: text("locale").notNull().default("en-US"),
  currency: text("currency").notNull().default("USD"),
  logoData: bytea("logo_data"),
  logoContentType: text("logo_content_type"),
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

/* ───────────────────────── QuickBooks billing records ───────────────────────── */

export const invoiceStatus = pgEnum("invoice_status", ["draft", "sent", "partially_paid", "paid", "cancelled", "refunded"]);

/** The CRM's linked copy of a QuickBooks invoice. No card or bank data is stored here. */
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
    qboInvoiceId: text("qbo_invoice_id"),
    qboInvoiceNumber: text("qbo_invoice_number"),
    qboRequestId: text("qbo_request_id"),
    /** Old records remain visible but are never payable or synchronized by this app. */
    legacyBilling: boolean("legacy_billing").notNull().default(false),
    subscriptionId: uuid("subscription_id"),
    billingPeriodStart: date("billing_period_start", { mode: "string" }),
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
    uniqueIndex("invoices_qbo_id_unique").on(t.firmId, t.qboInvoiceId),
    uniqueIndex("invoices_qbo_request_unique").on(t.qboRequestId),
    uniqueIndex("invoices_subscription_period_unique").on(t.subscriptionId, t.billingPeriodStart).where(sql`${t.subscriptionId} IS NOT NULL`),
    index("invoices_firm_idx").on(t.firmId),
    foreignKey({ name: "invoices_firm_client_fk", columns: [t.firmId, t.clientId], foreignColumns: [clients.firmId, clients.id] }),
    foreignKey({ name: "invoices_firm_engagement_fk", columns: [t.firmId, t.engagementId], foreignColumns: [engagements.firmId, engagements.id] }),
  ],
).enableRLS();

export const subscriptionStatus = pgEnum("subscription_status", ["pending", "active", "suspended", "cancelled", "expired"]);
export const billingInterval = pgEnum("billing_interval", ["month", "year"]);

/** PayPal plans for the CRM subscription product, keyed by billing interval. */
export const platformPlans = pgTable("platform_plans", {
  interval: text("interval").primaryKey(),
  amountCents: integer("amount_cents").notNull(),
  currency: text("currency").notNull(),
  paypalPlanId: text("paypal_plan_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

/** A staff-managed schedule for recurring QuickBooks invoices; it never charges a card itself. */
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
    legacyExternalPlanId: text("legacy_external_plan_id"),
    legacyExternalSubscriptionId: text("legacy_external_subscription_id"),
    legacyBilling: boolean("legacy_billing").notNull().default(false),
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
    uniqueIndex("subscriptions_legacy_external_id_unique").on(t.legacyExternalSubscriptionId),
    index("subscriptions_firm_idx").on(t.firmId),
    foreignKey({ name: "subscriptions_firm_client_fk", columns: [t.firmId, t.clientId], foreignColumns: [clients.firmId, clients.id] }),
  ],
).enableRLS();

/** Retained for reconciliation only; CRM subscription checkout now uses PayPal. */
export const platformBillingInvoices = pgTable(
  "platform_billing_invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: uuid("firm_id").notNull().references(() => firms.id, { onDelete: "restrict" }),
    interval: billingInterval("interval").notNull(),
    periodStart: date("period_start", { mode: "string" }).notNull(),
    totalCents: integer("total_cents").notNull(),
    currency: text("currency").notNull(),
    dueDate: date("due_date", { mode: "string" }),
    status: invoiceStatus("status").notNull().default("draft"),
    qboInvoiceId: text("qbo_invoice_id"),
    qboInvoiceNumber: text("qbo_invoice_number"),
    qboRequestId: text("qbo_request_id").notNull(),
    paymentUrl: text("payment_url"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    syncedAt: timestamp("synced_at", { withTimezone: true }),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("platform_billing_firm_period_unique").on(t.firmId, t.periodStart),
    uniqueIndex("platform_billing_qbo_id_unique").on(t.qboInvoiceId),
    uniqueIndex("platform_billing_request_unique").on(t.qboRequestId),
  ],
).enableRLS();

export const qboCustomerLinks = pgTable(
  "qbo_customer_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectionId: uuid("connection_id").notNull().references(() => qboConnections.id, { onDelete: "cascade" }),
    firmId: uuid("firm_id").notNull().references(() => firms.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
    qboCustomerId: text("qbo_customer_id").notNull(),
    displayName: text("display_name").notNull(),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("qbo_customer_links_connection_customer_unique").on(t.connectionId, t.qboCustomerId),
    uniqueIndex("qbo_customer_links_firm_client_unique").on(t.firmId, t.clientId),
    foreignKey({ name: "qbo_customer_links_firm_client_fk", columns: [t.firmId, t.clientId], foreignColumns: [clients.firmId, clients.id] }),
  ],
).enableRLS();

export const paypalWebhookEvents = pgTable("paypal_webhook_events", {
  eventId: text("event_id").primaryKey(),
  eventType: text("event_type").notNull(),
  subscriptionId: text("subscription_id"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

/* ───────────────────────── Practice workflow: contacts, onboarding, teams, templates, timeline ───────────────────────── */

/** Per-firm record numbers (L-, C-, E-, T-). Incremented inside the inserting transaction. */
export const firmCounters = pgTable(
  "firm_counters",
  {
    firmId: firmId(),
    kind: text("kind").notNull(), // "lead" | "client" | "engagement" | "task"
    value: integer("value").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.firmId, t.kind] })],
).enableRLS();

export const contactRole = pgEnum("contact_role", ["owner", "primary", "billing", "authorized_representative", "other"]);

/** People at a client (mainly for business clients): owner, primary, billing, authorized representative. */
export const clientContacts = pgTable(
  "client_contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: firmId(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    title: text("title"),
    role: contactRole("role").notNull().default("other"),
    email: text("email"),
    phone: text("phone"),
    isPrimary: boolean("is_primary").notNull().default(false),
    notes: text("notes"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("client_contacts_client_idx").on(t.clientId),
    foreignKey({ name: "client_contacts_firm_client_fk", columns: [t.firmId, t.clientId], foreignColumns: [clients.firmId, clients.id] }),
  ],
).enableRLS();

export const onboardingItemKind = pgEnum("onboarding_item_kind", ["information", "document"]);
export const onboardingItemStatus = pgEnum("onboarding_item_status", ["requested", "received", "verified", "waived"]);

/** The onboarding checklist: information and documents requested from a new client. */
export const onboardingItems = pgTable(
  "onboarding_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: firmId(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    kind: onboardingItemKind("kind").notNull().default("document"),
    status: onboardingItemStatus("status").notNull().default("requested"),
    /** The uploaded document that satisfied this item, if any. */
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "set null" }),
    requestedById: uuid("requested_by_id").references(() => users.id, { onDelete: "set null" }),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    verifiedById: uuid("verified_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    index("onboarding_items_client_idx").on(t.clientId),
    foreignKey({ name: "onboarding_items_firm_client_fk", columns: [t.firmId, t.clientId], foreignColumns: [clients.firmId, clients.id] }),
  ],
).enableRLS();

export const teamRole = pgEnum("team_role", ["manager", "staff", "reviewer"]);

/** Staff assigned to an engagement (the engagement manager is engagements.owner_id). */
export const engagementTeam = pgTable(
  "engagement_team",
  {
    firmId: firmId(),
    engagementId: uuid("engagement_id")
      .notNull()
      .references(() => engagements.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: teamRole("role").notNull().default("staff"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.engagementId, t.userId] }),
    index("engagement_team_user_idx").on(t.userId),
    foreignKey({ name: "engagement_team_firm_engagement_fk", columns: [t.firmId, t.engagementId], foreignColumns: [engagements.firmId, engagements.id] }),
    foreignKey({ name: "engagement_team_firm_user_fk", columns: [t.firmId, t.userId], foreignColumns: [users.firmId, users.id] }),
  ],
).enableRLS();

/** A task that cannot start until another is completed. */
export const taskDependencies = pgTable(
  "task_dependencies",
  {
    firmId: firmId(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    dependsOnTaskId: uuid("depends_on_task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.taskId, t.dependsOnTaskId] }),
    foreignKey({ name: "task_dependencies_firm_task_fk", columns: [t.firmId, t.taskId], foreignColumns: [tasks.firmId, tasks.id] }),
    foreignKey({ name: "task_dependencies_firm_depends_fk", columns: [t.firmId, t.dependsOnTaskId], foreignColumns: [tasks.firmId, tasks.id] }),
  ],
).enableRLS();

export const taskChecklistItems = pgTable(
  "task_checklist_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: firmId(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    done: boolean("done").notNull().default(false),
    sequence: integer("sequence").notNull().default(0),
    doneById: uuid("done_by_id").references(() => users.id, { onDelete: "set null" }),
    doneAt: timestamp("done_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("task_checklist_task_idx").on(t.taskId),
    foreignKey({ name: "task_checklist_firm_task_fk", columns: [t.firmId, t.taskId], foreignColumns: [tasks.firmId, tasks.id] }),
  ],
).enableRLS();

/** Reusable task sequences for a service (e.g. Annual Tax Preparation). */
export const workflowTemplates = pgTable(
  "workflow_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: firmId(),
    name: text("name").notNull(),
    description: text("description"),
    serviceType: serviceType("service_type").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [index("workflow_templates_firm_idx").on(t.firmId), unique("workflow_templates_firm_id_id_unique").on(t.firmId, t.id)],
).enableRLS();

export const templateAssigneeRole = pgEnum("template_assignee_role", ["manager", "staff", "reviewer", "unassigned"]);

export const workflowTemplateTasks = pgTable(
  "workflow_template_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: firmId(),
    templateId: uuid("template_id")
      .notNull()
      .references(() => workflowTemplates.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    defaultPriority: priority("default_priority").notNull().default("normal"),
    /** Due this many days after the engagement start date (or generation date). */
    relativeDueDays: integer("relative_due_days"),
    defaultAssignee: templateAssigneeRole("default_assignee").notNull().default("staff"),
    /** Sequence number of a step in the same template that must be completed first. */
    dependsOnSequence: integer("depends_on_sequence"),
    isClientTask: boolean("is_client_task").notNull().default(false),
  },
  (t) => [
    uniqueIndex("workflow_template_tasks_seq_unique").on(t.templateId, t.sequence),
    foreignKey({ name: "workflow_template_tasks_firm_template_fk", columns: [t.firmId, t.templateId], foreignColumns: [workflowTemplates.firmId, workflowTemplates.id] }),
  ],
).enableRLS();

/** One use of a template on an engagement. Unique per (engagement, template): prevents duplicate task sets. */
export const workflowInstances = pgTable(
  "workflow_instances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: firmId(),
    templateId: uuid("template_id")
      .notNull()
      .references(() => workflowTemplates.id, { onDelete: "restrict" }),
    /** Snapshot of the template name at generation time (history survives template edits). */
    templateName: text("template_name").notNull(),
    engagementId: uuid("engagement_id")
      .notNull()
      .references(() => engagements.id, { onDelete: "cascade" }),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("workflow_instances_engagement_template_unique").on(t.engagementId, t.templateId),
    foreignKey({ name: "workflow_instances_firm_engagement_fk", columns: [t.firmId, t.engagementId], foreignColumns: [engagements.firmId, engagements.id] }),
    foreignKey({ name: "workflow_instances_firm_template_fk", columns: [t.firmId, t.templateId], foreignColumns: [workflowTemplates.firmId, workflowTemplates.id] }),
  ],
).enableRLS();

export const activityType = pgEnum("activity_type", ["note", "call", "email", "meeting", "comment", "internal_note", "assignment", "status_change", "system"]);

/**
 * The business timeline shown on leads, clients, engagements and tasks: notes, calls, emails,
 * meetings, comments, assignments and status changes. (audit_events remains the security log.)
 * `body` is staff-written text; never put tax identifiers here.
 */
export const activities = pgTable(
  "activities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: firmId(),
    entityType: text("entity_type").notNull(), // "lead" | "client" | "engagement" | "task"
    entityId: uuid("entity_id").notNull(),
    /** For roll-up onto the client timeline. */
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    type: activityType("type").notNull(),
    body: text("body"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("activities_entity_idx").on(t.entityType, t.entityId, t.occurredAt),
    index("activities_client_idx").on(t.clientId, t.occurredAt),
    index("activities_firm_idx").on(t.firmId, t.occurredAt),
  ],
).enableRLS();

/** Every status change of a lead, engagement or task (who, when, from → to). */
export const statusHistory = pgTable(
  "status_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: firmId(),
    entityType: text("entity_type").notNull(), // "lead" | "engagement" | "task" | "client"
    entityId: uuid("entity_id").notNull(),
    oldStatus: text("old_status"),
    newStatus: text("new_status").notNull(),
    changedById: uuid("changed_by_id").references(() => users.id, { onDelete: "set null" }),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("status_history_entity_idx").on(t.entityType, t.entityId, t.createdAt)],
).enableRLS();

/* ───────────────────────── Tax preparation and returns ───────────────────────── */

/** Reusable, firm-configured requirements. A null taxpayer type/jurisdiction/year is a wildcard. */
export const taxDocumentTemplates = pgTable(
  "tax_document_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: firmId(),
    name: text("name").notNull(),
    description: text("description"),
    taxpayerType: clientType("taxpayer_type"),
    serviceType: serviceType("service_type").notNull(),
    jurisdiction: text("jurisdiction"),
    taxYear: integer("tax_year"),
    required: boolean("required").notNull().default(true),
    isActive: boolean("is_active").notNull().default(true),
    createdById: uuid("created_by_id"),
    ...timestamps,
  },
  (t) => [
    index("tax_document_templates_scope_idx").on(t.firmId, t.serviceType, t.taxYear),
    unique("tax_document_templates_firm_id_id_unique").on(t.firmId, t.id),
    foreignKey({ name: "tax_document_templates_firm_creator_fk", columns: [t.firmId, t.createdById], foreignColumns: [users.firmId, users.id] }),
  ],
).enableRLS();

/** One production case per tax filing scope. Requirements are snapshotted onto checklist items. */
export const taxPreparationCases = pgTable(
  "tax_preparation_cases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: firmId(),
    clientId: uuid("client_id").notNull(),
    engagementId: uuid("engagement_id"),
    taxYear: integer("tax_year").notNull(),
    taxPeriod: text("tax_period").notNull().default("annual"),
    jurisdiction: text("jurisdiction").notNull(),
    taxFormType: text("tax_form_type").notNull(),
    filingType: taxFilingType("filing_type").notNull().default("original"),
    returnSequence: integer("return_sequence").notNull().default(1),
    serviceType: serviceType("service_type").notNull(),
    preparerId: uuid("preparer_id"),
    reviewerId: uuid("reviewer_id"),
    status: taxPreparationStatus("status").notNull().default("not_started"),
    preparationStartedAt: timestamp("preparation_started_at", { withTimezone: true }),
    dueDate: date("due_date", { mode: "string" }),
    submittedForReviewAt: timestamp("submitted_for_review_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    internalNotes: text("internal_notes"),
    createdById: uuid("created_by_id"),
    ...timestamps,
  },
  (t) => [
    unique("tax_preparation_cases_firm_id_id_unique").on(t.firmId, t.id),
    uniqueIndex("tax_preparation_cases_scope_unique").on(
      t.firmId, t.clientId, t.taxYear, t.taxPeriod, t.jurisdiction, t.taxFormType, t.filingType, t.returnSequence,
    ),
    index("tax_preparation_cases_status_due_idx").on(t.firmId, t.status, t.dueDate),
    index("tax_preparation_cases_preparer_idx").on(t.firmId, t.preparerId, t.status),
    index("tax_preparation_cases_reviewer_idx").on(t.firmId, t.reviewerId, t.status),
    foreignKey({ name: "tax_preparation_cases_firm_client_fk", columns: [t.firmId, t.clientId], foreignColumns: [clients.firmId, clients.id] }),
    foreignKey({ name: "tax_preparation_cases_firm_engagement_fk", columns: [t.firmId, t.engagementId], foreignColumns: [engagements.firmId, engagements.id] }),
    foreignKey({ name: "tax_preparation_cases_firm_preparer_fk", columns: [t.firmId, t.preparerId], foreignColumns: [users.firmId, users.id] }),
    foreignKey({ name: "tax_preparation_cases_firm_reviewer_fk", columns: [t.firmId, t.reviewerId], foreignColumns: [users.firmId, users.id] }),
    foreignKey({ name: "tax_preparation_cases_firm_creator_fk", columns: [t.firmId, t.createdById], foreignColumns: [users.firmId, users.id] }),
  ],
).enableRLS();

export const taxPreparationChecklistItems = pgTable(
  "tax_preparation_checklist_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: firmId(),
    preparationCaseId: uuid("preparation_case_id").notNull(),
    templateId: uuid("template_id"),
    name: text("name").notNull(),
    description: text("description"),
    required: boolean("required").notNull().default(true),
    status: taxChecklistStatus("status").notNull().default("not_requested"),
    requestedAt: timestamp("requested_at", { withTimezone: true }),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    verifiedById: uuid("verified_by_id"),
    documentId: uuid("document_id"),
    notes: text("notes"),
    ...timestamps,
  },
  (t) => [
    index("tax_preparation_checklist_case_idx").on(t.firmId, t.preparationCaseId),
    foreignKey({ name: "tax_preparation_checklist_firm_case_fk", columns: [t.firmId, t.preparationCaseId], foreignColumns: [taxPreparationCases.firmId, taxPreparationCases.id] }),
    foreignKey({ name: "tax_preparation_checklist_firm_template_fk", columns: [t.firmId, t.templateId], foreignColumns: [taxDocumentTemplates.firmId, taxDocumentTemplates.id] }),
    foreignKey({ name: "tax_preparation_checklist_firm_verifier_fk", columns: [t.firmId, t.verifiedById], foreignColumns: [users.firmId, users.id] }),
    foreignKey({ name: "tax_preparation_checklist_firm_document_fk", columns: [t.firmId, t.documentId], foreignColumns: [documents.firmId, documents.id] }),
  ],
).enableRLS();

/** Current return record. Detailed tax values and identifiers are intentionally not stored. */
export const taxReturns = pgTable(
  "tax_returns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: firmId(),
    returnNumber: text("return_number").notNull(),
    clientId: uuid("client_id").notNull(),
    engagementId: uuid("engagement_id"),
    preparationCaseId: uuid("preparation_case_id"),
    taxpayerType: clientType("taxpayer_type").notNull(),
    taxYear: integer("tax_year").notNull(),
    taxPeriod: text("tax_period").notNull().default("annual"),
    taxFormType: text("tax_form_type").notNull(),
    jurisdiction: text("jurisdiction").notNull(),
    filingType: taxFilingType("filing_type").notNull().default("original"),
    returnSequence: integer("return_sequence").notNull().default(1),
    preparerId: uuid("preparer_id"),
    reviewerId: uuid("reviewer_id"),
    filingDeadline: date("filing_deadline", { mode: "string" }),
    status: taxReturnStatus("status").notNull().default("not_started"),
    reviewStatus: taxReviewStatus("review_status").notNull().default("not_started"),
    authorizationStatus: taxAuthorizationStatus("authorization_status").notNull().default("not_requested"),
    filingStatus: taxFilingStatus("filing_status").notNull().default("not_filed"),
    authorityStatus: taxAuthorityStatus("authority_status"),
    clientAuthorizedAt: timestamp("client_authorized_at", { withTimezone: true }),
    filingDate: date("filing_date", { mode: "string" }),
    submissionReference: text("submission_reference"),
    taxAuthorityResponse: text("tax_authority_response"),
    refundAmountCents: integer("refund_amount_cents"),
    amountOwedCents: integer("amount_owed_cents"),
    internalNotes: text("internal_notes"),
    createdById: uuid("created_by_id"),
    ...timestamps,
  },
  (t) => [
    unique("tax_returns_firm_id_id_unique").on(t.firmId, t.id),
    uniqueIndex("tax_returns_number_unique").on(t.firmId, t.returnNumber),
    uniqueIndex("tax_returns_case_unique").on(t.firmId, t.preparationCaseId),
    uniqueIndex("tax_returns_scope_unique").on(
      t.firmId, t.clientId, t.taxYear, t.taxPeriod, t.jurisdiction, t.taxFormType, t.filingType, t.returnSequence,
    ),
    index("tax_returns_status_deadline_idx").on(t.firmId, t.status, t.filingDeadline),
    index("tax_returns_preparer_idx").on(t.firmId, t.preparerId, t.status),
    index("tax_returns_reviewer_idx").on(t.firmId, t.reviewerId, t.status),
    foreignKey({ name: "tax_returns_firm_client_fk", columns: [t.firmId, t.clientId], foreignColumns: [clients.firmId, clients.id] }),
    foreignKey({ name: "tax_returns_firm_engagement_fk", columns: [t.firmId, t.engagementId], foreignColumns: [engagements.firmId, engagements.id] }),
    foreignKey({ name: "tax_returns_firm_case_fk", columns: [t.firmId, t.preparationCaseId], foreignColumns: [taxPreparationCases.firmId, taxPreparationCases.id] }),
    foreignKey({ name: "tax_returns_firm_preparer_fk", columns: [t.firmId, t.preparerId], foreignColumns: [users.firmId, users.id] }),
    foreignKey({ name: "tax_returns_firm_reviewer_fk", columns: [t.firmId, t.reviewerId], foreignColumns: [users.firmId, users.id] }),
    foreignKey({ name: "tax_returns_firm_creator_fk", columns: [t.firmId, t.createdById], foreignColumns: [users.firmId, users.id] }),
  ],
).enableRLS();

/** Append-only return lifecycle history; filing details are kept separate from audit metadata. */
export const taxReturnHistory = pgTable(
  "tax_return_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: firmId(),
    taxReturnId: uuid("tax_return_id").notNull(),
    actorId: uuid("actor_id"),
    eventType: text("event_type").notNull(),
    previousStatus: text("previous_status"),
    nextStatus: text("next_status"),
    filingDate: date("filing_date", { mode: "string" }),
    submissionReference: text("submission_reference"),
    authorityStatus: taxAuthorityStatus("authority_status"),
    authorityResponse: text("authority_response"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("tax_return_history_return_idx").on(t.firmId, t.taxReturnId, t.createdAt),
    foreignKey({ name: "tax_return_history_firm_return_fk", columns: [t.firmId, t.taxReturnId], foreignColumns: [taxReturns.firmId, taxReturns.id] }),
    foreignKey({ name: "tax_return_history_firm_actor_fk", columns: [t.firmId, t.actorId], foreignColumns: [users.firmId, users.id] }),
  ],
).enableRLS();

/* ───────────────────────── Client collaboration: requests, attachments, reads, signatures, portal access ───────────────────────── */

export const documentRequestStatus = pgEnum("document_request_status", ["draft", "sent", "partially_fulfilled", "fulfilled", "overdue", "cancelled"]);
export const documentRequestItemStatus = pgEnum("document_request_item_status", ["pending", "uploaded", "under_review", "verified", "rejected", "replacement_requested", "waived"]);

/** A request for one or more documents from a client (e.g. "2026 tax documents"). */
export const documentRequests = pgTable(
  "document_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: firmId(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "restrict" }),
    requestNumber: integer("request_number"),
    engagementId: uuid("engagement_id").references(() => engagements.id, { onDelete: "set null" }),
    taxPreparationCaseId: uuid("tax_preparation_case_id"),
    title: text("title").notNull(),
    description: text("description"),
    status: documentRequestStatus("status").notNull().default("draft"),
    dueDate: date("due_date", { mode: "string" }),
    requestedById: uuid("requested_by_id").references(() => users.id, { onDelete: "set null" }),
    assignedContactId: uuid("assigned_contact_id").references(() => clientContacts.id, { onDelete: "set null" }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("document_requests_client_idx").on(t.clientId, t.status),
    uniqueIndex("document_requests_firm_number_unique").on(t.firmId, t.requestNumber),
    unique("document_requests_firm_id_id_unique").on(t.firmId, t.id),
    foreignKey({ name: "document_requests_firm_client_fk", columns: [t.firmId, t.clientId], foreignColumns: [clients.firmId, clients.id] }),
    foreignKey({ name: "document_requests_firm_engagement_fk", columns: [t.firmId, t.engagementId], foreignColumns: [engagements.firmId, engagements.id] }),
    foreignKey({ name: "document_requests_firm_tax_case_fk", columns: [t.firmId, t.taxPreparationCaseId], foreignColumns: [taxPreparationCases.firmId, taxPreparationCases.id] }),
  ],
).enableRLS();

/** One requested document within a request; fulfilled by an uploaded document. */
export const documentRequestItems = pgTable(
  "document_request_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: firmId(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => documentRequests.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    category: documentCategory("category").notNull().default("other"),
    required: boolean("required").notNull().default(true),
    status: documentRequestItemStatus("status").notNull().default("pending"),
    /** The current document that satisfies this item (latest version). */
    fulfilledDocumentId: uuid("fulfilled_document_id").references((): AnyPgColumn => documents.id, { onDelete: "set null" }),
    sequence: integer("sequence").notNull().default(0),
    ...timestamps,
  },
  (t) => [
    index("document_request_items_request_idx").on(t.requestId),
    unique("document_request_items_firm_id_id_unique").on(t.firmId, t.id),
    foreignKey({ name: "document_request_items_firm_request_fk", columns: [t.firmId, t.requestId], foreignColumns: [documentRequests.firmId, documentRequests.id] }),
  ],
).enableRLS();

/** Files attached to a message (the bytes live once, as a document). */
export const messageAttachments = pgTable(
  "message_attachments",
  {
    firmId: firmId(),
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.messageId, t.documentId] }),
    foreignKey({ name: "message_attachments_firm_message_fk", columns: [t.firmId, t.messageId], foreignColumns: [messages.firmId, messages.id] }),
    foreignKey({ name: "message_attachments_firm_document_fk", columns: [t.firmId, t.documentId], foreignColumns: [documents.firmId, documents.id] }),
  ],
).enableRLS();

/** Per-person read position in a conversation (unread counts for every staff member and portal user). */
export const conversationReads = pgTable(
  "conversation_reads",
  {
    firmId: firmId(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    lastReadAt: timestamp("last_read_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.conversationId, t.userId] }),
    foreignKey({ name: "conversation_reads_firm_conversation_fk", columns: [t.firmId, t.conversationId], foreignColumns: [conversations.firmId, conversations.id] }),
  ],
).enableRLS();

export const portalAccessRole = pgEnum("portal_access_role", ["owner", "contact", "viewer"]);
export const portalAccessStatus = pgEnum("portal_access_status", ["active", "suspended"]);

/**
 * Which client records a portal login may access (business clients can have several contacts;
 * one person can be a contact for several clients). The ONLY source of portal authorization —
 * a client id sent by the browser is never trusted.
 */
export const portalClientAccess = pgTable(
  "portal_client_access",
  {
    firmId: firmId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    role: portalAccessRole("role").notNull().default("contact"),
    status: portalAccessStatus("status").notNull().default("active"),
    contactId: uuid("contact_id").references(() => clientContacts.id, { onDelete: "set null" }),
    grantedById: uuid("granted_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.clientId] }),
    index("portal_client_access_client_idx").on(t.clientId),
    foreignKey({ name: "portal_client_access_firm_user_fk", columns: [t.firmId, t.userId], foreignColumns: [users.firmId, users.id] }),
    foreignKey({ name: "portal_client_access_firm_client_fk", columns: [t.firmId, t.clientId], foreignColumns: [clients.firmId, clients.id] }),
  ],
).enableRLS();

/** In-app notifications for portal users (never implies an email was sent). */
export const clientNotifications = pgTable(
  "client_notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: firmId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // "message" | "document_request" | "document_shared" | "signature_request" | "invoice"
    title: text("title").notNull(),
    href: text("href"),
    /** Prevents duplicate notifications for the same event. */
    dedupeKey: text("dedupe_key").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("client_notifications_dedupe_unique").on(t.userId, t.dedupeKey),
    index("client_notifications_user_idx").on(t.userId, t.readAt, t.createdAt),
    foreignKey({ name: "client_notifications_firm_client_fk", columns: [t.firmId, t.clientId], foreignColumns: [clients.firmId, clients.id] }),
  ],
).enableRLS();

export const signatureStatus = pgEnum("signature_status", ["draft", "sent", "viewed", "partially_signed", "signed", "declined", "expired", "voided", "failed"]);
export const signerStatus = pgEnum("signer_status", ["pending", "sent", "viewed", "signed", "declined"]);
export const signatureDocumentType = pgEnum("signature_document_type", [
  "engagement_letter",
  "service_agreement",
  "tax_filing_authorization",
  "client_consent",
  "disclosure",
  "financial_information_authorization",
  "other",
]);

/** An e-signature request sent through a real provider (Dropbox Sign). Status only changes from verified provider events. */
export const signatureRequests = pgTable(
  "signature_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: firmId(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "restrict" }),
    requestNumber: integer("request_number"),
    engagementId: uuid("engagement_id").references(() => engagements.id, { onDelete: "set null" }),
    taxReturnId: uuid("tax_return_id"),
    /** The document sent for signature. */
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "restrict" }),
    /** The signed copy retrieved from the provider. */
    signedDocumentId: uuid("signed_document_id").references(() => documents.id, { onDelete: "set null" }),
    documentType: signatureDocumentType("document_type").notNull().default("other"),
    provider: text("provider").notNull(),
    providerRequestId: text("provider_request_id"),
    /** Provider test mode (no legal effect). */
    testMode: boolean("test_mode").notNull().default(true),
    title: text("title").notNull(),
    message: text("message"),
    status: signatureStatus("status").notNull().default("draft"),
    sentById: uuid("sent_by_id").references(() => users.id, { onDelete: "set null" }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    failureReason: text("failure_reason"),
    ...timestamps,
  },
  (t) => [
    index("signature_requests_client_idx").on(t.clientId),
    uniqueIndex("signature_requests_provider_id_unique").on(t.provider, t.providerRequestId),
    uniqueIndex("signature_requests_firm_number_unique").on(t.firmId, t.requestNumber),
    unique("signature_requests_firm_id_id_unique").on(t.firmId, t.id),
    foreignKey({ name: "signature_requests_firm_client_fk", columns: [t.firmId, t.clientId], foreignColumns: [clients.firmId, clients.id] }),
    foreignKey({ name: "signature_requests_firm_engagement_fk", columns: [t.firmId, t.engagementId], foreignColumns: [engagements.firmId, engagements.id] }),
    foreignKey({ name: "signature_requests_firm_document_fk", columns: [t.firmId, t.documentId], foreignColumns: [documents.firmId, documents.id] }),
    foreignKey({ name: "signature_requests_firm_tax_return_fk", columns: [t.firmId, t.taxReturnId], foreignColumns: [taxReturns.firmId, taxReturns.id] }),
  ],
).enableRLS();

export const signatureSigners = pgTable(
  "signature_signers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: firmId(),
    signatureRequestId: uuid("signature_request_id")
      .notNull()
      .references(() => signatureRequests.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    email: text("email").notNull(),
    role: text("role"),
    signingOrder: integer("signing_order").notNull().default(1),
    status: signerStatus("status").notNull().default("pending"),
    /** Provider's id for this signer (signature_id in Dropbox Sign). */
    providerSignerId: text("provider_signer_id"),
    /** A portal user who may open this signer's session (resolved on the server). */
    portalUserId: uuid("portal_user_id").references(() => users.id, { onDelete: "set null" }),
    viewedAt: timestamp("viewed_at", { withTimezone: true }),
    signedAt: timestamp("signed_at", { withTimezone: true }),
    declinedAt: timestamp("declined_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("signature_signers_request_idx").on(t.signatureRequestId),
    foreignKey({ name: "signature_signers_firm_request_fk", columns: [t.firmId, t.signatureRequestId], foreignColumns: [signatureRequests.firmId, signatureRequests.id] }),
  ],
).enableRLS();

/** Verified provider webhook events, stored once each (idempotency + signing audit trail). */
export const signatureEvents = pgTable(
  "signature_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: uuid("firm_id").references(() => firms.id, { onDelete: "restrict" }),
    provider: text("provider").notNull(),
    /** Provider's unique event identity (hash), used to ignore duplicate deliveries. */
    providerEventKey: text("provider_event_key").notNull(),
    eventType: text("event_type").notNull(),
    providerRequestId: text("provider_request_id"),
    signatureRequestId: uuid("signature_request_id").references(() => signatureRequests.id, { onDelete: "set null" }),
    occurredAt: timestamp("occurred_at", { withTimezone: true }),
    /** Minimal, non-sensitive event fields (no document contents). */
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("signature_events_provider_key_unique").on(t.provider, t.providerEventKey), index("signature_events_request_idx").on(t.signatureRequestId)],
).enableRLS();

export type User = typeof users.$inferSelect;
export type DocumentCategory = (typeof documentCategory.enumValues)[number];
export type DocumentStatus = (typeof documentStatus.enumValues)[number];
export type DocumentVisibility = (typeof documentVisibility.enumValues)[number];
export type ConversationStatus = (typeof conversationStatus.enumValues)[number];
export type ConversationCategory = (typeof conversationCategory.enumValues)[number];
export type SignatureStatus = (typeof signatureStatus.enumValues)[number];
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
export type TaskStatus = (typeof taskStatus.enumValues)[number];
export type Priority = (typeof priority.enumValues)[number];
export type OnboardingStatus = (typeof onboardingStatus.enumValues)[number];
export type ProposalStatus = (typeof proposalStatus.enumValues)[number];
export type ActivityType = (typeof activityType.enumValues)[number];
export type ContactRole = (typeof contactRole.enumValues)[number];
export type UserRole = (typeof userRole.enumValues)[number];
export type EngagementStatus = (typeof engagementStatus.enumValues)[number];
export type ServiceType = (typeof serviceType.enumValues)[number];
export type ClientType = (typeof clientType.enumValues)[number];
export type ClientStatus = (typeof clientStatus.enumValues)[number];
export type TaxPreparationStatus = (typeof taxPreparationStatus.enumValues)[number];
export type TaxChecklistStatus = (typeof taxChecklistStatus.enumValues)[number];
export type TaxReturnStatus = (typeof taxReturnStatus.enumValues)[number];
export type TaxFilingType = (typeof taxFilingType.enumValues)[number];
export type TaxReviewStatus = (typeof taxReviewStatus.enumValues)[number];
export type TaxAuthorizationStatus = (typeof taxAuthorizationStatus.enumValues)[number];
export type TaxFilingStatus = (typeof taxFilingStatus.enumValues)[number];
export type TaxAuthorityStatus = (typeof taxAuthorityStatus.enumValues)[number];
export type TaxPreparationCase = typeof taxPreparationCases.$inferSelect;
export type TaxPreparationChecklistItem = typeof taxPreparationChecklistItems.$inferSelect;
export type TaxReturn = typeof taxReturns.$inferSelect;
