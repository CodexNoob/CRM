CREATE TYPE "public"."tax_authority_status" AS ENUM('pending', 'accepted', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."tax_authorization_status" AS ENUM('not_requested', 'requested', 'authorized', 'declined');--> statement-breakpoint
CREATE TYPE "public"."tax_checklist_status" AS ENUM('not_requested', 'requested', 'received', 'under_review', 'verified', 'rejected', 'not_applicable');--> statement-breakpoint
CREATE TYPE "public"."tax_filing_status" AS ENUM('not_filed', 'filed', 'accepted', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."tax_filing_type" AS ENUM('original', 'amended');--> statement-breakpoint
CREATE TYPE "public"."tax_preparation_status" AS ENUM('not_started', 'documents_requested', 'awaiting_documents', 'documents_received', 'verification', 'ready_for_preparation', 'in_preparation', 'internal_review', 'changes_required', 'completed');--> statement-breakpoint
CREATE TYPE "public"."tax_return_status" AS ENUM('not_started', 'waiting_for_documents', 'in_preparation', 'ready_for_review', 'under_review', 'changes_required', 'awaiting_client_approval', 'approved', 'filed', 'accepted', 'rejected', 'amended');--> statement-breakpoint
CREATE TYPE "public"."tax_review_status" AS ENUM('not_started', 'pending', 'changes_required', 'approved');--> statement-breakpoint
CREATE TABLE "tax_document_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"taxpayer_type" "client_type",
	"service_type" "service_type" NOT NULL,
	"jurisdiction" text,
	"tax_year" integer,
	"required" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_document_templates_firm_id_id_unique" UNIQUE("firm_id","id")
);
--> statement-breakpoint
ALTER TABLE "tax_document_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tax_preparation_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"engagement_id" uuid,
	"tax_year" integer NOT NULL,
	"tax_period" text DEFAULT 'annual' NOT NULL,
	"jurisdiction" text NOT NULL,
	"tax_form_type" text NOT NULL,
	"filing_type" "tax_filing_type" DEFAULT 'original' NOT NULL,
	"return_sequence" integer DEFAULT 1 NOT NULL,
	"service_type" "service_type" NOT NULL,
	"preparer_id" uuid,
	"reviewer_id" uuid,
	"status" "tax_preparation_status" DEFAULT 'not_started' NOT NULL,
	"preparation_started_at" timestamp with time zone,
	"due_date" date,
	"submitted_for_review_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"internal_notes" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_preparation_cases_firm_id_id_unique" UNIQUE("firm_id","id")
);
--> statement-breakpoint
ALTER TABLE "tax_preparation_cases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tax_preparation_checklist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"preparation_case_id" uuid NOT NULL,
	"template_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"required" boolean DEFAULT true NOT NULL,
	"status" "tax_checklist_status" DEFAULT 'not_requested' NOT NULL,
	"requested_at" timestamp with time zone,
	"received_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"verified_by_id" uuid,
	"document_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tax_preparation_checklist_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tax_return_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"tax_return_id" uuid NOT NULL,
	"actor_id" uuid,
	"event_type" text NOT NULL,
	"previous_status" text,
	"next_status" text,
	"filing_date" date,
	"submission_reference" text,
	"authority_status" "tax_authority_status",
	"authority_response" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tax_return_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tax_returns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"return_number" text NOT NULL,
	"client_id" uuid NOT NULL,
	"engagement_id" uuid,
	"preparation_case_id" uuid,
	"taxpayer_type" "client_type" NOT NULL,
	"tax_year" integer NOT NULL,
	"tax_period" text DEFAULT 'annual' NOT NULL,
	"tax_form_type" text NOT NULL,
	"jurisdiction" text NOT NULL,
	"filing_type" "tax_filing_type" DEFAULT 'original' NOT NULL,
	"return_sequence" integer DEFAULT 1 NOT NULL,
	"preparer_id" uuid,
	"reviewer_id" uuid,
	"filing_deadline" date,
	"status" "tax_return_status" DEFAULT 'not_started' NOT NULL,
	"review_status" "tax_review_status" DEFAULT 'not_started' NOT NULL,
	"authorization_status" "tax_authorization_status" DEFAULT 'not_requested' NOT NULL,
	"filing_status" "tax_filing_status" DEFAULT 'not_filed' NOT NULL,
	"authority_status" "tax_authority_status",
	"client_authorized_at" timestamp with time zone,
	"filing_date" date,
	"submission_reference" text,
	"tax_authority_response" text,
	"refund_amount_cents" integer,
	"amount_owed_cents" integer,
	"internal_notes" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_returns_firm_id_id_unique" UNIQUE("firm_id","id")
);
--> statement-breakpoint
ALTER TABLE "tax_returns" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tax_document_templates" ADD CONSTRAINT "tax_document_templates_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_document_templates" ADD CONSTRAINT "tax_document_templates_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_preparation_cases" ADD CONSTRAINT "tax_preparation_cases_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_preparation_cases" ADD CONSTRAINT "tax_preparation_cases_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_preparation_cases" ADD CONSTRAINT "tax_preparation_cases_firm_client_fk" FOREIGN KEY ("firm_id","client_id") REFERENCES "public"."clients"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_preparation_cases" ADD CONSTRAINT "tax_preparation_cases_firm_engagement_fk" FOREIGN KEY ("firm_id","engagement_id") REFERENCES "public"."engagements"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_preparation_cases" ADD CONSTRAINT "tax_preparation_cases_firm_preparer_fk" FOREIGN KEY ("firm_id","preparer_id") REFERENCES "public"."users"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_preparation_cases" ADD CONSTRAINT "tax_preparation_cases_firm_reviewer_fk" FOREIGN KEY ("firm_id","reviewer_id") REFERENCES "public"."users"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_preparation_checklist_items" ADD CONSTRAINT "tax_preparation_checklist_items_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_preparation_checklist_items" ADD CONSTRAINT "tax_preparation_checklist_firm_case_fk" FOREIGN KEY ("firm_id","preparation_case_id") REFERENCES "public"."tax_preparation_cases"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_preparation_checklist_items" ADD CONSTRAINT "tax_preparation_checklist_firm_template_fk" FOREIGN KEY ("firm_id","template_id") REFERENCES "public"."tax_document_templates"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_preparation_checklist_items" ADD CONSTRAINT "tax_preparation_checklist_firm_verifier_fk" FOREIGN KEY ("firm_id","verified_by_id") REFERENCES "public"."users"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_preparation_checklist_items" ADD CONSTRAINT "tax_preparation_checklist_document_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_return_history" ADD CONSTRAINT "tax_return_history_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_return_history" ADD CONSTRAINT "tax_return_history_firm_return_fk" FOREIGN KEY ("firm_id","tax_return_id") REFERENCES "public"."tax_returns"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_return_history" ADD CONSTRAINT "tax_return_history_firm_actor_fk" FOREIGN KEY ("firm_id","actor_id") REFERENCES "public"."users"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_returns" ADD CONSTRAINT "tax_returns_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_returns" ADD CONSTRAINT "tax_returns_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_returns" ADD CONSTRAINT "tax_returns_firm_client_fk" FOREIGN KEY ("firm_id","client_id") REFERENCES "public"."clients"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_returns" ADD CONSTRAINT "tax_returns_firm_engagement_fk" FOREIGN KEY ("firm_id","engagement_id") REFERENCES "public"."engagements"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_returns" ADD CONSTRAINT "tax_returns_firm_case_fk" FOREIGN KEY ("firm_id","preparation_case_id") REFERENCES "public"."tax_preparation_cases"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_returns" ADD CONSTRAINT "tax_returns_firm_preparer_fk" FOREIGN KEY ("firm_id","preparer_id") REFERENCES "public"."users"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_returns" ADD CONSTRAINT "tax_returns_firm_reviewer_fk" FOREIGN KEY ("firm_id","reviewer_id") REFERENCES "public"."users"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tax_document_templates_scope_idx" ON "tax_document_templates" USING btree ("firm_id","service_type","tax_year");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_preparation_cases_scope_unique" ON "tax_preparation_cases" USING btree ("firm_id","client_id","tax_year","tax_period","jurisdiction","tax_form_type","filing_type","return_sequence");--> statement-breakpoint
CREATE INDEX "tax_preparation_cases_status_due_idx" ON "tax_preparation_cases" USING btree ("firm_id","status","due_date");--> statement-breakpoint
CREATE INDEX "tax_preparation_cases_preparer_idx" ON "tax_preparation_cases" USING btree ("firm_id","preparer_id","status");--> statement-breakpoint
CREATE INDEX "tax_preparation_cases_reviewer_idx" ON "tax_preparation_cases" USING btree ("firm_id","reviewer_id","status");--> statement-breakpoint
CREATE INDEX "tax_preparation_checklist_case_idx" ON "tax_preparation_checklist_items" USING btree ("firm_id","preparation_case_id");--> statement-breakpoint
CREATE INDEX "tax_return_history_return_idx" ON "tax_return_history" USING btree ("firm_id","tax_return_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_returns_number_unique" ON "tax_returns" USING btree ("firm_id","return_number");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_returns_case_unique" ON "tax_returns" USING btree ("firm_id","preparation_case_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_returns_scope_unique" ON "tax_returns" USING btree ("firm_id","client_id","tax_year","tax_period","jurisdiction","tax_form_type","filing_type","return_sequence");--> statement-breakpoint
CREATE INDEX "tax_returns_status_deadline_idx" ON "tax_returns" USING btree ("firm_id","status","filing_deadline");--> statement-breakpoint
CREATE INDEX "tax_returns_preparer_idx" ON "tax_returns" USING btree ("firm_id","preparer_id","status");--> statement-breakpoint
CREATE INDEX "tax_returns_reviewer_idx" ON "tax_returns" USING btree ("firm_id","reviewer_id","status");--> statement-breakpoint
-- Supabase's Data API roles must not bypass the application's service-layer authorization.
DO $$
DECLARE
  r text;
  t text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      FOREACH t IN ARRAY ARRAY['tax_document_templates', 'tax_preparation_cases', 'tax_preparation_checklist_items', 'tax_returns', 'tax_return_history'] LOOP
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', t, r);
      END LOOP;
    END IF;
  END LOOP;
END
$$;