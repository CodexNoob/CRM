-- Multi-firm (tenancy). Hand-ordered: existing data moves into firm #1, then columns become required and composite keys are added.
CREATE TYPE "public"."firm_status" AS ENUM('trial', 'active', 'past_due', 'cancelled');--> statement-breakpoint
CREATE TABLE "firms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"status" "firm_status" DEFAULT 'trial' NOT NULL,
	"trial_ends_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "firms" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- Firm #1 owns everything that already exists (the original firm). Active, not on trial.
INSERT INTO "firms" ("name", "slug", "status")
SELECT coalesce((SELECT "name" FROM "firm_profile" ORDER BY "id" LIMIT 1), 'My Firm'), 'my-firm', 'active'
WHERE EXISTS (SELECT 1 FROM "users") OR EXISTS (SELECT 1 FROM "clients") OR EXISTS (SELECT 1 FROM "firm_profile") OR EXISTS (SELECT 1 FROM "leads") OR EXISTS (SELECT 1 FROM "announcements") OR EXISTS (SELECT 1 FROM "audit_events");--> statement-breakpoint
ALTER TABLE "announcements" ADD COLUMN "firm_id" uuid;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "firm_id" uuid;--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "firm_id" uuid;--> statement-breakpoint
ALTER TABLE "client_assignments" ADD COLUMN "firm_id" uuid;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "firm_id" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "firm_id" uuid;--> statement-breakpoint
ALTER TABLE "engagements" ADD COLUMN "firm_id" uuid;--> statement-breakpoint
ALTER TABLE "firm_profile" ADD COLUMN "firm_id" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "firm_id" uuid;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "firm_id" uuid;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "firm_id" uuid;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "firm_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "firm_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "firm_id" uuid;--> statement-breakpoint
UPDATE "announcements" SET "firm_id" = (SELECT "id" FROM "firms" ORDER BY "created_at" LIMIT 1) WHERE "firm_id" IS NULL;--> statement-breakpoint
UPDATE "appointments" SET "firm_id" = (SELECT "id" FROM "firms" ORDER BY "created_at" LIMIT 1) WHERE "firm_id" IS NULL;--> statement-breakpoint
UPDATE "audit_events" SET "firm_id" = (SELECT "id" FROM "firms" ORDER BY "created_at" LIMIT 1) WHERE "firm_id" IS NULL;--> statement-breakpoint
UPDATE "client_assignments" SET "firm_id" = (SELECT "id" FROM "firms" ORDER BY "created_at" LIMIT 1) WHERE "firm_id" IS NULL;--> statement-breakpoint
UPDATE "clients" SET "firm_id" = (SELECT "id" FROM "firms" ORDER BY "created_at" LIMIT 1) WHERE "firm_id" IS NULL;--> statement-breakpoint
UPDATE "documents" SET "firm_id" = (SELECT "id" FROM "firms" ORDER BY "created_at" LIMIT 1) WHERE "firm_id" IS NULL;--> statement-breakpoint
UPDATE "engagements" SET "firm_id" = (SELECT "id" FROM "firms" ORDER BY "created_at" LIMIT 1) WHERE "firm_id" IS NULL;--> statement-breakpoint
UPDATE "firm_profile" SET "firm_id" = (SELECT "id" FROM "firms" ORDER BY "created_at" LIMIT 1) WHERE "firm_id" IS NULL;--> statement-breakpoint
UPDATE "invoices" SET "firm_id" = (SELECT "id" FROM "firms" ORDER BY "created_at" LIMIT 1) WHERE "firm_id" IS NULL;--> statement-breakpoint
UPDATE "leads" SET "firm_id" = (SELECT "id" FROM "firms" ORDER BY "created_at" LIMIT 1) WHERE "firm_id" IS NULL;--> statement-breakpoint
UPDATE "messages" SET "firm_id" = (SELECT "id" FROM "firms" ORDER BY "created_at" LIMIT 1) WHERE "firm_id" IS NULL;--> statement-breakpoint
UPDATE "subscriptions" SET "firm_id" = (SELECT "id" FROM "firms" ORDER BY "created_at" LIMIT 1) WHERE "firm_id" IS NULL;--> statement-breakpoint
UPDATE "tasks" SET "firm_id" = (SELECT "id" FROM "firms" ORDER BY "created_at" LIMIT 1) WHERE "firm_id" IS NULL;--> statement-breakpoint
UPDATE "users" SET "firm_id" = (SELECT "id" FROM "firms" ORDER BY "created_at" LIMIT 1) WHERE "firm_id" IS NULL;--> statement-breakpoint
ALTER TABLE "announcements" ALTER COLUMN "firm_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "appointments" ALTER COLUMN "firm_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "client_assignments" ALTER COLUMN "firm_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ALTER COLUMN "firm_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ALTER COLUMN "firm_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "engagements" ALTER COLUMN "firm_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "firm_profile" ALTER COLUMN "firm_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ALTER COLUMN "firm_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ALTER COLUMN "firm_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "firm_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ALTER COLUMN "firm_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "firm_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "firm_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_firm_id_id_unique" UNIQUE("firm_id","id");--> statement-breakpoint
ALTER TABLE "engagements" ADD CONSTRAINT "engagements_firm_id_id_unique" UNIQUE("firm_id","id");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_firm_id_id_unique" UNIQUE("firm_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "firms_slug_unique" ON "firms" USING btree ("slug");--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_firm_client_fk" FOREIGN KEY ("firm_id","client_id") REFERENCES "public"."clients"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_firm_owner_fk" FOREIGN KEY ("firm_id","owner_id") REFERENCES "public"."users"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_assignments" ADD CONSTRAINT "client_assignments_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_assignments" ADD CONSTRAINT "client_assignments_firm_client_fk" FOREIGN KEY ("firm_id","client_id") REFERENCES "public"."clients"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_assignments" ADD CONSTRAINT "client_assignments_firm_user_fk" FOREIGN KEY ("firm_id","user_id") REFERENCES "public"."users"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_firm_client_fk" FOREIGN KEY ("firm_id","client_id") REFERENCES "public"."clients"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_firm_engagement_fk" FOREIGN KEY ("firm_id","engagement_id") REFERENCES "public"."engagements"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagements" ADD CONSTRAINT "engagements_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagements" ADD CONSTRAINT "engagements_firm_client_fk" FOREIGN KEY ("firm_id","client_id") REFERENCES "public"."clients"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagements" ADD CONSTRAINT "engagements_firm_owner_fk" FOREIGN KEY ("firm_id","owner_id") REFERENCES "public"."users"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "firm_profile" ADD CONSTRAINT "firm_profile_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_firm_client_fk" FOREIGN KEY ("firm_id","client_id") REFERENCES "public"."clients"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_firm_engagement_fk" FOREIGN KEY ("firm_id","engagement_id") REFERENCES "public"."engagements"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_firm_owner_fk" FOREIGN KEY ("firm_id","owner_id") REFERENCES "public"."users"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_firm_client_fk" FOREIGN KEY ("firm_id","converted_client_id") REFERENCES "public"."clients"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_firm_client_fk" FOREIGN KEY ("firm_id","client_id") REFERENCES "public"."clients"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_firm_client_fk" FOREIGN KEY ("firm_id","client_id") REFERENCES "public"."clients"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_firm_engagement_fk" FOREIGN KEY ("firm_id","engagement_id") REFERENCES "public"."engagements"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_firm_assignee_fk" FOREIGN KEY ("firm_id","assignee_id") REFERENCES "public"."users"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_firm_client_fk" FOREIGN KEY ("firm_id","client_id") REFERENCES "public"."clients"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "announcements_firm_idx" ON "announcements" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "appointments_firm_idx" ON "appointments" USING btree ("firm_id","starts_at");--> statement-breakpoint
CREATE INDEX "audit_firm_created_idx" ON "audit_events" USING btree ("firm_id","created_at");--> statement-breakpoint
CREATE INDEX "clients_firm_idx" ON "clients" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "documents_firm_idx" ON "documents" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "engagements_firm_idx" ON "engagements" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "invoices_firm_idx" ON "invoices" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "leads_firm_idx" ON "leads" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "messages_firm_idx" ON "messages" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "subscriptions_firm_idx" ON "subscriptions" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "tasks_firm_idx" ON "tasks" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "users_firm_idx" ON "users" USING btree ("firm_id");
