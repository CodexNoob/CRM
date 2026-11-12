CREATE TYPE "public"."activity_type" AS ENUM('note', 'call', 'email', 'meeting', 'comment', 'internal_note', 'assignment', 'status_change', 'system');--> statement-breakpoint
CREATE TYPE "public"."billing_frequency" AS ENUM('one_time', 'monthly', 'quarterly', 'annually', 'hourly');--> statement-breakpoint
CREATE TYPE "public"."contact_role" AS ENUM('owner', 'primary', 'billing', 'authorized_representative', 'other');--> statement-breakpoint
CREATE TYPE "public"."onboarding_item_kind" AS ENUM('information', 'document');--> statement-breakpoint
CREATE TYPE "public"."onboarding_item_status" AS ENUM('requested', 'received', 'verified', 'waived');--> statement-breakpoint
CREATE TYPE "public"."onboarding_status" AS ENUM('not_started', 'information_requested', 'awaiting_documents', 'under_verification', 'completed');--> statement-breakpoint
CREATE TYPE "public"."priority" AS ENUM('low', 'normal', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."proposal_status" AS ENUM('not_required', 'draft', 'sent', 'accepted', 'declined');--> statement-breakpoint
CREATE TYPE "public"."team_role" AS ENUM('manager', 'staff', 'reviewer');--> statement-breakpoint
CREATE TYPE "public"."template_assignee_role" AS ENUM('manager', 'staff', 'reviewer', 'unassigned');--> statement-breakpoint
ALTER TYPE "public"."client_status" ADD VALUE 'onboarding' BEFORE 'active';--> statement-breakpoint
ALTER TYPE "public"."client_status" ADD VALUE 'on_hold';--> statement-breakpoint
ALTER TYPE "public"."client_status" ADD VALUE 'former';--> statement-breakpoint
ALTER TYPE "public"."engagement_status" ADD VALUE 'draft' BEFORE 'not_started';--> statement-breakpoint
ALTER TYPE "public"."engagement_status" ADD VALUE 'proposal_sent' BEFORE 'not_started';--> statement-breakpoint
ALTER TYPE "public"."engagement_status" ADD VALUE 'awaiting_acceptance' BEFORE 'not_started';--> statement-breakpoint
ALTER TYPE "public"."engagement_status" ADD VALUE 'active' BEFORE 'not_started';--> statement-breakpoint
ALTER TYPE "public"."engagement_status" ADD VALUE 'cancelled';--> statement-breakpoint
ALTER TYPE "public"."engagement_status" ADD VALUE 'closed';--> statement-breakpoint
ALTER TYPE "public"."lead_status" ADD VALUE 'consultation_scheduled' BEFORE 'converted';--> statement-breakpoint
ALTER TYPE "public"."lead_status" ADD VALUE 'proposal_sent' BEFORE 'converted';--> statement-breakpoint
ALTER TYPE "public"."lead_status" ADD VALUE 'negotiation' BEFORE 'converted';--> statement-breakpoint
ALTER TYPE "public"."lead_status" ADD VALUE 'nurture';--> statement-breakpoint
CREATE TABLE "activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"client_id" uuid,
	"actor_id" uuid,
	"type" "activity_type" NOT NULL,
	"body" text,
	"metadata" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "activities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "client_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"name" text NOT NULL,
	"title" text,
	"role" "contact_role" DEFAULT 'other' NOT NULL,
	"email" text,
	"phone" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"notes" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "client_contacts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "engagement_team" (
	"firm_id" uuid NOT NULL,
	"engagement_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "team_role" DEFAULT 'staff' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "engagement_team_engagement_id_user_id_pk" PRIMARY KEY("engagement_id","user_id")
);--> statement-breakpoint
ALTER TABLE "engagement_team" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "firm_counters" (
	"firm_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"value" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "firm_counters_firm_id_kind_pk" PRIMARY KEY("firm_id","kind")
);--> statement-breakpoint
ALTER TABLE "firm_counters" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "onboarding_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"title" text NOT NULL,
	"kind" "onboarding_item_kind" DEFAULT 'document' NOT NULL,
	"status" "onboarding_item_status" DEFAULT 'requested' NOT NULL,
	"document_id" uuid,
	"requested_by_id" uuid,
	"received_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"verified_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "onboarding_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"old_status" text,
	"new_status" text NOT NULL,
	"changed_by_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "status_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "task_checklist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"title" text NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"sequence" integer DEFAULT 0 NOT NULL,
	"done_by_id" uuid,
	"done_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "task_checklist_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "task_dependencies" (
	"firm_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"depends_on_task_id" uuid NOT NULL,
	CONSTRAINT "task_dependencies_task_id_depends_on_task_id_pk" PRIMARY KEY("task_id","depends_on_task_id")
);--> statement-breakpoint
ALTER TABLE "task_dependencies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "workflow_instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"template_name" text NOT NULL,
	"engagement_id" uuid NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "workflow_instances" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "workflow_template_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"default_priority" "priority" DEFAULT 'normal' NOT NULL,
	"relative_due_days" integer,
	"default_assignee" "template_assignee_role" DEFAULT 'staff' NOT NULL,
	"depends_on_sequence" integer,
	"is_client_task" boolean DEFAULT false NOT NULL
);--> statement-breakpoint
ALTER TABLE "workflow_template_tasks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "workflow_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"service_type" "service_type" NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_templates_firm_id_id_unique" UNIQUE("firm_id","id")
);--> statement-breakpoint
ALTER TABLE "workflow_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "status" SET DEFAULT 'todo'::text;--> statement-breakpoint
-- Keep existing tasks: open becomes To Do, done becomes Completed.
UPDATE "tasks" SET "status" = CASE "status" WHEN 'open' THEN 'todo' WHEN 'done' THEN 'completed' ELSE "status" END;--> statement-breakpoint
DROP TYPE "public"."task_status";--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('todo', 'in_progress', 'waiting_client', 'waiting_review', 'blocked', 'completed', 'cancelled');--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "status" SET DEFAULT 'todo'::"public"."task_status";--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "status" SET DATA TYPE "public"."task_status" USING "status"::"public"."task_status";--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DATA TYPE text;--> statement-breakpoint
-- Keep existing users' access: partner becomes manager, preparer becomes employee.
UPDATE "users" SET "role" = CASE "role" WHEN 'partner' THEN 'manager' WHEN 'preparer' THEN 'employee' ELSE "role" END;--> statement-breakpoint
DROP TYPE "public"."user_role";--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'manager', 'employee', 'read_only', 'client');--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DATA TYPE "public"."user_role" USING "role"::"public"."user_role";--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "engagement_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "client_number" integer;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "first_name" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "last_name" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "account_manager_id" uuid;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "onboarding_status" "onboarding_status" DEFAULT 'not_started' NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "source_lead_id" uuid;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "task_id" uuid;--> statement-breakpoint
ALTER TABLE "engagements" ADD COLUMN "engagement_number" integer;--> statement-breakpoint
ALTER TABLE "engagements" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "engagements" ADD COLUMN "period_start" date;--> statement-breakpoint
ALTER TABLE "engagements" ADD COLUMN "period_end" date;--> statement-breakpoint
ALTER TABLE "engagements" ADD COLUMN "start_date" date;--> statement-breakpoint
ALTER TABLE "engagements" ADD COLUMN "fee_cents" integer;--> statement-breakpoint
ALTER TABLE "engagements" ADD COLUMN "billing_frequency" "billing_frequency";--> statement-breakpoint
ALTER TABLE "engagements" ADD COLUMN "priority" "priority" DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE "engagements" ADD COLUMN "proposal_status" "proposal_status" DEFAULT 'not_required' NOT NULL;--> statement-breakpoint
ALTER TABLE "engagements" ADD COLUMN "accepted_on" date;--> statement-breakpoint
ALTER TABLE "engagements" ADD COLUMN "work_override_by_id" uuid;--> statement-breakpoint
ALTER TABLE "engagements" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "engagements" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "engagements" ADD COLUMN "created_by_id" uuid;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "lead_number" integer;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "client_type" "client_type";--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "requested_services" "service_type"[];--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "estimated_value_cents" integer;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "priority" "priority" DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "last_contacted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "lost_reason" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "converted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "converted_by_id" uuid;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "client_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "task_number" integer;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "assigned_by_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "priority" "priority" DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "start_date" date;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "estimated_minutes" integer;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "actual_minutes" integer;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "parent_task_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "workflow_instance_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "sequence" integer;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_firm_id_id_unique" UNIQUE("firm_id","id");--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_contacts" ADD CONSTRAINT "client_contacts_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_contacts" ADD CONSTRAINT "client_contacts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_contacts" ADD CONSTRAINT "client_contacts_firm_client_fk" FOREIGN KEY ("firm_id","client_id") REFERENCES "public"."clients"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_team" ADD CONSTRAINT "engagement_team_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_team" ADD CONSTRAINT "engagement_team_engagement_id_engagements_id_fk" FOREIGN KEY ("engagement_id") REFERENCES "public"."engagements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_team" ADD CONSTRAINT "engagement_team_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_team" ADD CONSTRAINT "engagement_team_firm_engagement_fk" FOREIGN KEY ("firm_id","engagement_id") REFERENCES "public"."engagements"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_team" ADD CONSTRAINT "engagement_team_firm_user_fk" FOREIGN KEY ("firm_id","user_id") REFERENCES "public"."users"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "firm_counters" ADD CONSTRAINT "firm_counters_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_items" ADD CONSTRAINT "onboarding_items_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_items" ADD CONSTRAINT "onboarding_items_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_items" ADD CONSTRAINT "onboarding_items_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_items" ADD CONSTRAINT "onboarding_items_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_items" ADD CONSTRAINT "onboarding_items_verified_by_id_users_id_fk" FOREIGN KEY ("verified_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_items" ADD CONSTRAINT "onboarding_items_firm_client_fk" FOREIGN KEY ("firm_id","client_id") REFERENCES "public"."clients"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_history" ADD CONSTRAINT "status_history_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_history" ADD CONSTRAINT "status_history_changed_by_id_users_id_fk" FOREIGN KEY ("changed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_checklist_items" ADD CONSTRAINT "task_checklist_items_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_checklist_items" ADD CONSTRAINT "task_checklist_items_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_checklist_items" ADD CONSTRAINT "task_checklist_items_done_by_id_users_id_fk" FOREIGN KEY ("done_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_checklist_items" ADD CONSTRAINT "task_checklist_firm_task_fk" FOREIGN KEY ("firm_id","task_id") REFERENCES "public"."tasks"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_depends_on_task_id_tasks_id_fk" FOREIGN KEY ("depends_on_task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_firm_task_fk" FOREIGN KEY ("firm_id","task_id") REFERENCES "public"."tasks"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_firm_depends_fk" FOREIGN KEY ("firm_id","depends_on_task_id") REFERENCES "public"."tasks"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_instances" ADD CONSTRAINT "workflow_instances_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_instances" ADD CONSTRAINT "workflow_instances_template_id_workflow_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."workflow_templates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_instances" ADD CONSTRAINT "workflow_instances_engagement_id_engagements_id_fk" FOREIGN KEY ("engagement_id") REFERENCES "public"."engagements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_instances" ADD CONSTRAINT "workflow_instances_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_instances" ADD CONSTRAINT "workflow_instances_firm_engagement_fk" FOREIGN KEY ("firm_id","engagement_id") REFERENCES "public"."engagements"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_instances" ADD CONSTRAINT "workflow_instances_firm_template_fk" FOREIGN KEY ("firm_id","template_id") REFERENCES "public"."workflow_templates"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_template_tasks" ADD CONSTRAINT "workflow_template_tasks_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_template_tasks" ADD CONSTRAINT "workflow_template_tasks_template_id_workflow_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."workflow_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_template_tasks" ADD CONSTRAINT "workflow_template_tasks_firm_template_fk" FOREIGN KEY ("firm_id","template_id") REFERENCES "public"."workflow_templates"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_templates" ADD CONSTRAINT "workflow_templates_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_templates" ADD CONSTRAINT "workflow_templates_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activities_entity_idx" ON "activities" USING btree ("entity_type","entity_id","occurred_at");--> statement-breakpoint
CREATE INDEX "activities_client_idx" ON "activities" USING btree ("client_id","occurred_at");--> statement-breakpoint
CREATE INDEX "activities_firm_idx" ON "activities" USING btree ("firm_id","occurred_at");--> statement-breakpoint
CREATE INDEX "client_contacts_client_idx" ON "client_contacts" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "engagement_team_user_idx" ON "engagement_team" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "onboarding_items_client_idx" ON "onboarding_items" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "status_history_entity_idx" ON "status_history" USING btree ("entity_type","entity_id","created_at");--> statement-breakpoint
CREATE INDEX "task_checklist_task_idx" ON "task_checklist_items" USING btree ("task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_instances_engagement_template_unique" ON "workflow_instances" USING btree ("engagement_id","template_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_template_tasks_seq_unique" ON "workflow_template_tasks" USING btree ("template_id","sequence");--> statement-breakpoint
CREATE INDEX "workflow_templates_firm_idx" ON "workflow_templates" USING btree ("firm_id");--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_account_manager_id_users_id_fk" FOREIGN KEY ("account_manager_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_firm_account_manager_fk" FOREIGN KEY ("firm_id","account_manager_id") REFERENCES "public"."users"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_firm_task_fk" FOREIGN KEY ("firm_id","task_id") REFERENCES "public"."tasks"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagements" ADD CONSTRAINT "engagements_work_override_by_id_users_id_fk" FOREIGN KEY ("work_override_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagements" ADD CONSTRAINT "engagements_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_converted_by_id_users_id_fk" FOREIGN KEY ("converted_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assigned_by_id_users_id_fk" FOREIGN KEY ("assigned_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_firm_client_fk" FOREIGN KEY ("firm_id","client_id") REFERENCES "public"."clients"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_firm_parent_fk" FOREIGN KEY ("firm_id","parent_task_id") REFERENCES "public"."tasks"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "clients_firm_number_unique" ON "clients" USING btree ("firm_id","client_number");--> statement-breakpoint
CREATE INDEX "clients_account_manager_idx" ON "clients" USING btree ("account_manager_id");--> statement-breakpoint
CREATE INDEX "documents_task_idx" ON "documents" USING btree ("task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "engagements_firm_number_unique" ON "engagements" USING btree ("firm_id","engagement_number");--> statement-breakpoint
CREATE UNIQUE INDEX "leads_firm_number_unique" ON "leads" USING btree ("firm_id","lead_number");--> statement-breakpoint
CREATE INDEX "leads_follow_up_idx" ON "leads" USING btree ("firm_id","follow_up_date");--> statement-breakpoint
CREATE INDEX "tasks_client_idx" ON "tasks" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "tasks_assignee_status_idx" ON "tasks" USING btree ("assignee_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_firm_number_unique" ON "tasks" USING btree ("firm_id","task_number");--> statement-breakpoint
-- Backfill for existing records ----------------------------------------------------------
-- Tasks belong to their engagement's client.
UPDATE "tasks" t SET "client_id" = e."client_id" FROM "engagements" e WHERE e."id" = t."engagement_id" AND t."client_id" IS NULL;--> statement-breakpoint
-- Leads: requested services start from the single service they asked about.
UPDATE "leads" SET "requested_services" = ARRAY["service_interest"] WHERE "service_interest" IS NOT NULL AND "requested_services" IS NULL;--> statement-breakpoint
-- Per-firm record numbers, in creation order.
UPDATE "leads" x SET "lead_number" = n.rn FROM (SELECT "id", row_number() OVER (PARTITION BY "firm_id" ORDER BY "created_at", "id") AS rn FROM "leads") n WHERE n."id" = x."id";--> statement-breakpoint
UPDATE "clients" x SET "client_number" = n.rn FROM (SELECT "id", row_number() OVER (PARTITION BY "firm_id" ORDER BY "created_at", "id") AS rn FROM "clients") n WHERE n."id" = x."id";--> statement-breakpoint
UPDATE "engagements" x SET "engagement_number" = n.rn FROM (SELECT "id", row_number() OVER (PARTITION BY "firm_id" ORDER BY "created_at", "id") AS rn FROM "engagements") n WHERE n."id" = x."id";--> statement-breakpoint
UPDATE "tasks" x SET "task_number" = n.rn FROM (SELECT "id", row_number() OVER (PARTITION BY "firm_id" ORDER BY "created_at", "id") AS rn FROM "tasks") n WHERE n."id" = x."id";--> statement-breakpoint
INSERT INTO "firm_counters" ("firm_id", "kind", "value")
SELECT "firm_id", 'lead', max("lead_number") FROM "leads" GROUP BY "firm_id"
UNION ALL SELECT "firm_id", 'client', max("client_number") FROM "clients" GROUP BY "firm_id"
UNION ALL SELECT "firm_id", 'engagement', max("engagement_number") FROM "engagements" GROUP BY "firm_id"
UNION ALL SELECT "firm_id", 'task', max("task_number") FROM "tasks" GROUP BY "firm_id"
ON CONFLICT ("firm_id", "kind") DO UPDATE SET "value" = EXCLUDED."value";--> statement-breakpoint
-- The engagement manager is part of the engagement team.
INSERT INTO "engagement_team" ("firm_id", "engagement_id", "user_id", "role") SELECT "firm_id", "id", "owner_id", 'manager' FROM "engagements" ON CONFLICT DO NOTHING;
