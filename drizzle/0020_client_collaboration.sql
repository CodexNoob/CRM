CREATE TYPE "public"."conversation_category" AS ENUM('general_inquiry', 'document_request', 'tax_preparation', 'tax_return', 'bookkeeping', 'billing', 'appointment', 'engagement', 'other');--> statement-breakpoint
CREATE TYPE "public"."conversation_status" AS ENUM('open', 'waiting_for_client', 'waiting_for_staff', 'in_progress', 'resolved', 'closed');--> statement-breakpoint
CREATE TYPE "public"."document_category" AS ENUM('tax_documents', 'income_statements', 'bank_statements', 'financial_reports', 'expense_receipts', 'invoices', 'contracts', 'engagement_letters', 'tax_returns', 'identity_documents', 'payroll_documents', 'bookkeeping_records', 'other');--> statement-breakpoint
CREATE TYPE "public"."document_request_item_status" AS ENUM('pending', 'uploaded', 'under_review', 'verified', 'rejected', 'replacement_requested', 'waived');--> statement-breakpoint
CREATE TYPE "public"."document_request_status" AS ENUM('draft', 'sent', 'partially_fulfilled', 'fulfilled', 'overdue', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('requested', 'uploaded', 'under_review', 'verified', 'rejected', 'replacement_requested', 'archived');--> statement-breakpoint
CREATE TYPE "public"."document_visibility" AS ENUM('internal_only', 'client_visible', 'shared_with_client');--> statement-breakpoint
CREATE TYPE "public"."portal_access_role" AS ENUM('owner', 'contact', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."portal_access_status" AS ENUM('active', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."signature_document_type" AS ENUM('engagement_letter', 'service_agreement', 'tax_filing_authorization', 'client_consent', 'disclosure', 'financial_information_authorization', 'other');--> statement-breakpoint
CREATE TYPE "public"."signature_status" AS ENUM('draft', 'sent', 'viewed', 'partially_signed', 'signed', 'declined', 'expired', 'voided', 'failed');--> statement-breakpoint
CREATE TYPE "public"."signer_status" AS ENUM('pending', 'sent', 'viewed', 'signed', 'declined');--> statement-breakpoint
CREATE TABLE "client_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"href" text,
	"dedupe_key" text NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "client_notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "conversation_reads" (
	"firm_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"last_read_at" timestamp with time zone NOT NULL,
	CONSTRAINT "conversation_reads_conversation_id_user_id_pk" PRIMARY KEY("conversation_id","user_id")
);--> statement-breakpoint
ALTER TABLE "conversation_reads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"conversation_number" integer,
	"subject" text NOT NULL,
	"category" "conversation_category" DEFAULT 'general_inquiry' NOT NULL,
	"status" "conversation_status" DEFAULT 'open' NOT NULL,
	"priority" "priority" DEFAULT 'normal' NOT NULL,
	"engagement_id" uuid,
	"tax_return_id" uuid,
	"assigned_staff_id" uuid,
	"created_by_id" uuid,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_firm_id_id_unique" UNIQUE("firm_id","id")
);--> statement-breakpoint
ALTER TABLE "conversations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "document_request_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"category" "document_category" DEFAULT 'other' NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"status" "document_request_item_status" DEFAULT 'pending' NOT NULL,
	"fulfilled_document_id" uuid,
	"sequence" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_request_items_firm_id_id_unique" UNIQUE("firm_id","id")
);--> statement-breakpoint
ALTER TABLE "document_request_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "document_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"request_number" integer,
	"engagement_id" uuid,
	"tax_preparation_case_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"status" "document_request_status" DEFAULT 'draft' NOT NULL,
	"due_date" date,
	"requested_by_id" uuid,
	"assigned_contact_id" uuid,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_requests_firm_id_id_unique" UNIQUE("firm_id","id")
);--> statement-breakpoint
ALTER TABLE "document_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "message_attachments" (
	"firm_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_attachments_message_id_document_id_pk" PRIMARY KEY("message_id","document_id")
);--> statement-breakpoint
ALTER TABLE "message_attachments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "portal_client_access" (
	"firm_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"role" "portal_access_role" DEFAULT 'contact' NOT NULL,
	"status" "portal_access_status" DEFAULT 'active' NOT NULL,
	"contact_id" uuid,
	"granted_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portal_client_access_user_id_client_id_pk" PRIMARY KEY("user_id","client_id")
);--> statement-breakpoint
ALTER TABLE "portal_client_access" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "signature_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid,
	"provider" text NOT NULL,
	"provider_event_key" text NOT NULL,
	"event_type" text NOT NULL,
	"provider_request_id" text,
	"signature_request_id" uuid,
	"occurred_at" timestamp with time zone,
	"payload" jsonb,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "signature_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "signature_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"request_number" integer,
	"engagement_id" uuid,
	"tax_return_id" uuid,
	"document_id" uuid,
	"signed_document_id" uuid,
	"document_type" "signature_document_type" DEFAULT 'other' NOT NULL,
	"provider" text NOT NULL,
	"provider_request_id" text,
	"test_mode" boolean DEFAULT true NOT NULL,
	"title" text NOT NULL,
	"message" text,
	"status" "signature_status" DEFAULT 'draft' NOT NULL,
	"sent_by_id" uuid,
	"sent_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signature_requests_firm_id_id_unique" UNIQUE("firm_id","id")
);--> statement-breakpoint
ALTER TABLE "signature_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "signature_signers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"signature_request_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"signing_order" integer DEFAULT 1 NOT NULL,
	"status" "signer_status" DEFAULT 'pending' NOT NULL,
	"provider_signer_id" text,
	"portal_user_id" uuid,
	"viewed_at" timestamp with time zone,
	"signed_at" timestamp with time zone,
	"declined_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "signature_signers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "document_number" integer;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "category" "document_category" DEFAULT 'other' NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "status" "document_status" DEFAULT 'uploaded' NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "visibility" "document_visibility" DEFAULT 'internal_only' NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "version_number" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "root_document_id" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "previous_version_id" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "is_current_version" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "tax_preparation_case_id" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "tax_return_id" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "document_request_item_id" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "reviewed_by_id" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "review_note" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "expiration_date" date;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "internal_notes" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "tax_year" integer;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "storage_provider" text DEFAULT 'database' NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "conversation_id" uuid;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "is_internal" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "message_type" text DEFAULT 'message' NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "edited_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_firm_id_id_unique" UNIQUE("firm_id","id");--> statement-breakpoint
ALTER TABLE "client_notifications" ADD CONSTRAINT "client_notifications_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_notifications" ADD CONSTRAINT "client_notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_notifications" ADD CONSTRAINT "client_notifications_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_notifications" ADD CONSTRAINT "client_notifications_firm_client_fk" FOREIGN KEY ("firm_id","client_id") REFERENCES "public"."clients"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_reads" ADD CONSTRAINT "conversation_reads_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_reads" ADD CONSTRAINT "conversation_reads_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_reads" ADD CONSTRAINT "conversation_reads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_reads" ADD CONSTRAINT "conversation_reads_firm_conversation_fk" FOREIGN KEY ("firm_id","conversation_id") REFERENCES "public"."conversations"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_engagement_id_engagements_id_fk" FOREIGN KEY ("engagement_id") REFERENCES "public"."engagements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_assigned_staff_id_users_id_fk" FOREIGN KEY ("assigned_staff_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_firm_client_fk" FOREIGN KEY ("firm_id","client_id") REFERENCES "public"."clients"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_firm_engagement_fk" FOREIGN KEY ("firm_id","engagement_id") REFERENCES "public"."engagements"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_firm_assignee_fk" FOREIGN KEY ("firm_id","assigned_staff_id") REFERENCES "public"."users"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_firm_tax_return_fk" FOREIGN KEY ("firm_id","tax_return_id") REFERENCES "public"."tax_returns"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_request_items" ADD CONSTRAINT "document_request_items_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_request_items" ADD CONSTRAINT "document_request_items_request_id_document_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."document_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_request_items" ADD CONSTRAINT "document_request_items_fulfilled_document_id_documents_id_fk" FOREIGN KEY ("fulfilled_document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_request_items" ADD CONSTRAINT "document_request_items_firm_request_fk" FOREIGN KEY ("firm_id","request_id") REFERENCES "public"."document_requests"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_requests" ADD CONSTRAINT "document_requests_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_requests" ADD CONSTRAINT "document_requests_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_requests" ADD CONSTRAINT "document_requests_engagement_id_engagements_id_fk" FOREIGN KEY ("engagement_id") REFERENCES "public"."engagements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_requests" ADD CONSTRAINT "document_requests_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_requests" ADD CONSTRAINT "document_requests_assigned_contact_id_client_contacts_id_fk" FOREIGN KEY ("assigned_contact_id") REFERENCES "public"."client_contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_requests" ADD CONSTRAINT "document_requests_firm_client_fk" FOREIGN KEY ("firm_id","client_id") REFERENCES "public"."clients"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_requests" ADD CONSTRAINT "document_requests_firm_engagement_fk" FOREIGN KEY ("firm_id","engagement_id") REFERENCES "public"."engagements"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_requests" ADD CONSTRAINT "document_requests_firm_tax_case_fk" FOREIGN KEY ("firm_id","tax_preparation_case_id") REFERENCES "public"."tax_preparation_cases"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_firm_message_fk" FOREIGN KEY ("firm_id","message_id") REFERENCES "public"."messages"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_firm_document_fk" FOREIGN KEY ("firm_id","document_id") REFERENCES "public"."documents"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_client_access" ADD CONSTRAINT "portal_client_access_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_client_access" ADD CONSTRAINT "portal_client_access_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_client_access" ADD CONSTRAINT "portal_client_access_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_client_access" ADD CONSTRAINT "portal_client_access_contact_id_client_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."client_contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_client_access" ADD CONSTRAINT "portal_client_access_granted_by_id_users_id_fk" FOREIGN KEY ("granted_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_client_access" ADD CONSTRAINT "portal_client_access_firm_user_fk" FOREIGN KEY ("firm_id","user_id") REFERENCES "public"."users"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_client_access" ADD CONSTRAINT "portal_client_access_firm_client_fk" FOREIGN KEY ("firm_id","client_id") REFERENCES "public"."clients"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_events" ADD CONSTRAINT "signature_events_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_events" ADD CONSTRAINT "signature_events_signature_request_id_signature_requests_id_fk" FOREIGN KEY ("signature_request_id") REFERENCES "public"."signature_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_requests" ADD CONSTRAINT "signature_requests_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_requests" ADD CONSTRAINT "signature_requests_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_requests" ADD CONSTRAINT "signature_requests_engagement_id_engagements_id_fk" FOREIGN KEY ("engagement_id") REFERENCES "public"."engagements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_requests" ADD CONSTRAINT "signature_requests_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_requests" ADD CONSTRAINT "signature_requests_signed_document_id_documents_id_fk" FOREIGN KEY ("signed_document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_requests" ADD CONSTRAINT "signature_requests_sent_by_id_users_id_fk" FOREIGN KEY ("sent_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_requests" ADD CONSTRAINT "signature_requests_firm_client_fk" FOREIGN KEY ("firm_id","client_id") REFERENCES "public"."clients"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_requests" ADD CONSTRAINT "signature_requests_firm_engagement_fk" FOREIGN KEY ("firm_id","engagement_id") REFERENCES "public"."engagements"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_requests" ADD CONSTRAINT "signature_requests_firm_document_fk" FOREIGN KEY ("firm_id","document_id") REFERENCES "public"."documents"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_requests" ADD CONSTRAINT "signature_requests_firm_tax_return_fk" FOREIGN KEY ("firm_id","tax_return_id") REFERENCES "public"."tax_returns"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_signers" ADD CONSTRAINT "signature_signers_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_signers" ADD CONSTRAINT "signature_signers_signature_request_id_signature_requests_id_fk" FOREIGN KEY ("signature_request_id") REFERENCES "public"."signature_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_signers" ADD CONSTRAINT "signature_signers_portal_user_id_users_id_fk" FOREIGN KEY ("portal_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_signers" ADD CONSTRAINT "signature_signers_firm_request_fk" FOREIGN KEY ("firm_id","signature_request_id") REFERENCES "public"."signature_requests"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "client_notifications_dedupe_unique" ON "client_notifications" USING btree ("user_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "client_notifications_user_idx" ON "client_notifications" USING btree ("user_id","read_at","created_at");--> statement-breakpoint
CREATE INDEX "conversations_client_idx" ON "conversations" USING btree ("client_id","last_message_at");--> statement-breakpoint
CREATE INDEX "conversations_firm_status_idx" ON "conversations" USING btree ("firm_id","status","last_message_at");--> statement-breakpoint
CREATE INDEX "conversations_assigned_idx" ON "conversations" USING btree ("assigned_staff_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_firm_number_unique" ON "conversations" USING btree ("firm_id","conversation_number");--> statement-breakpoint
CREATE INDEX "document_request_items_request_idx" ON "document_request_items" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "document_requests_client_idx" ON "document_requests" USING btree ("client_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "document_requests_firm_number_unique" ON "document_requests" USING btree ("firm_id","request_number");--> statement-breakpoint
CREATE INDEX "portal_client_access_client_idx" ON "portal_client_access" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "signature_events_provider_key_unique" ON "signature_events" USING btree ("provider","provider_event_key");--> statement-breakpoint
CREATE INDEX "signature_events_request_idx" ON "signature_events" USING btree ("signature_request_id");--> statement-breakpoint
CREATE INDEX "signature_requests_client_idx" ON "signature_requests" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "signature_requests_provider_id_unique" ON "signature_requests" USING btree ("provider","provider_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "signature_requests_firm_number_unique" ON "signature_requests" USING btree ("firm_id","request_number");--> statement-breakpoint
CREATE INDEX "signature_signers_request_idx" ON "signature_signers" USING btree ("signature_request_id");--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_reviewed_by_id_users_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_firm_tax_case_fk" FOREIGN KEY ("firm_id","tax_preparation_case_id") REFERENCES "public"."tax_preparation_cases"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_firm_tax_return_fk" FOREIGN KEY ("firm_id","tax_return_id") REFERENCES "public"."tax_returns"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_firm_request_item_fk" FOREIGN KEY ("firm_id","document_request_item_id") REFERENCES "public"."document_request_items"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_firm_root_fk" FOREIGN KEY ("firm_id","root_document_id") REFERENCES "public"."documents"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_firm_previous_fk" FOREIGN KEY ("firm_id","previous_version_id") REFERENCES "public"."documents"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_firm_conversation_fk" FOREIGN KEY ("firm_id","conversation_id") REFERENCES "public"."conversations"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documents_root_idx" ON "documents" USING btree ("root_document_id");--> statement-breakpoint
CREATE INDEX "documents_firm_status_idx" ON "documents" USING btree ("firm_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_firm_number_version_unique" ON "documents" USING btree ("firm_id","document_number","version_number");--> statement-breakpoint
CREATE INDEX "messages_conversation_idx" ON "messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
-- Backfill for existing records --------------------------------------------------------------
-- Documents: number them per firm, title = file name, visibility from the old flag. Existing files stay where they are (database storage).
UPDATE "documents" x SET "document_number" = n.rn FROM (SELECT "id", row_number() OVER (PARTITION BY "firm_id" ORDER BY "created_at", "id") AS rn FROM "documents") n WHERE n."id" = x."id";
--> statement-breakpoint
UPDATE "documents" SET "title" = "file_name" WHERE "title" IS NULL;
--> statement-breakpoint
UPDATE "documents" SET "visibility" = CASE WHEN "visible_to_client" THEN 'client_visible'::document_visibility ELSE 'internal_only'::document_visibility END;
--> statement-breakpoint
UPDATE "documents" SET "status" = 'archived'::document_status WHERE "deleted_at" IS NOT NULL;
--> statement-breakpoint
-- Messages: every client with messages gets one "General" conversation holding its existing thread.
INSERT INTO "conversations" ("firm_id", "client_id", "subject", "category", "status", "last_message_at", "created_at", "updated_at")
SELECT "firm_id", "client_id", 'General', 'general_inquiry', 'open', max("created_at"), min("created_at"), max("created_at") FROM "messages" GROUP BY "firm_id", "client_id";
--> statement-breakpoint
UPDATE "messages" m SET "conversation_id" = c."id" FROM "conversations" c WHERE c."firm_id" = m."firm_id" AND c."client_id" = m."client_id" AND m."conversation_id" IS NULL;
--> statement-breakpoint
UPDATE "conversations" x SET "conversation_number" = n.rn FROM (SELECT "id", row_number() OVER (PARTITION BY "firm_id" ORDER BY "created_at", "id") AS rn FROM "conversations") n WHERE n."id" = x."id";
--> statement-breakpoint
-- Portal logins keep access to their own client.
INSERT INTO "portal_client_access" ("firm_id", "user_id", "client_id", "role", "status")
SELECT "firm_id", "id", "client_id", 'owner', CASE WHEN "is_active" THEN 'active'::portal_access_status ELSE 'suspended'::portal_access_status END FROM "users" WHERE "role" = 'client' AND "client_id" IS NOT NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "firm_counters" ("firm_id", "kind", "value")
SELECT "firm_id", 'document', max("document_number") FROM "documents" GROUP BY "firm_id"
UNION ALL SELECT "firm_id", 'conversation', max("conversation_number") FROM "conversations" GROUP BY "firm_id"
ON CONFLICT ("firm_id", "kind") DO UPDATE SET "value" = GREATEST("firm_counters"."value", EXCLUDED."value");
--> statement-breakpoint
-- Same protection as earlier migrations: Supabase API roles get no access to the new tables.
DO $$
DECLARE
  r text;
  t text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      FOREACH t IN ARRAY ARRAY['conversations','document_requests','document_request_items','message_attachments','conversation_reads','portal_client_access','client_notifications','signature_requests','signature_signers','signature_events'] LOOP
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', t, r);
      END LOOP;
    END IF;
  END LOOP;
END
$$;