CREATE TABLE "platform_inquiries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"topic" text NOT NULL,
	"message" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform_inquiries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "platform_settings" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"name" text DEFAULT 'CRM Platform' NOT NULL,
	"description" text,
	"website_url" text,
	"official_email" text,
	"phone" text,
	"address_line1" text,
	"address_line2" text,
	"sales_email" text,
	"support_email" text,
	"support_phone" text,
	"logo_data" "bytea",
	"logo_content_type" text,
	"updated_by_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "firm_profile" ADD COLUMN "website_url" text;--> statement-breakpoint
ALTER TABLE "firm_profile" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "firm_profile" ADD COLUMN "social_links" jsonb;--> statement-breakpoint
ALTER TABLE "firm_profile" ADD COLUMN "time_zone" text DEFAULT 'America/New_York' NOT NULL;--> statement-breakpoint
ALTER TABLE "firm_profile" ADD COLUMN "locale" text DEFAULT 'en-US' NOT NULL;--> statement-breakpoint
ALTER TABLE "firm_profile" ADD COLUMN "currency" text DEFAULT 'USD' NOT NULL;--> statement-breakpoint
ALTER TABLE "firm_profile" ADD COLUMN "logo_data" "bytea";--> statement-breakpoint
ALTER TABLE "firm_profile" ADD COLUMN "logo_content_type" text;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD CONSTRAINT "platform_settings_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_inquiries_created_idx" ON "platform_inquiries" USING btree ("created_at");--> statement-breakpoint
DO $$
DECLARE
  r text;
  t text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      FOREACH t IN ARRAY ARRAY['platform_settings', 'platform_inquiries'] LOOP
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', t, r);
      END LOOP;
    END IF;
  END LOOP;
END
$$;