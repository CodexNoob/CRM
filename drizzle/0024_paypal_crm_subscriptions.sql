-- Restore PayPal as the CRM subscription processor without rewriting migration 0023.
-- Previous PayPal agreement IDs were retained in legacy_external_subscription_id.
ALTER TABLE "firms" ADD COLUMN "paypal_subscription_id" text;--> statement-breakpoint
ALTER TABLE "firms" ADD COLUMN "paypal_checkout_request_id" text;--> statement-breakpoint
UPDATE "firms" SET "paypal_subscription_id" = "legacy_external_subscription_id" WHERE "legacy_external_subscription_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "firms_paypal_subscription_unique" ON "firms" USING btree ("paypal_subscription_id");--> statement-breakpoint
CREATE UNIQUE INDEX "firms_paypal_checkout_request_unique" ON "firms" USING btree ("paypal_checkout_request_id");--> statement-breakpoint
CREATE TABLE "platform_plans" (
	"interval" text PRIMARY KEY NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text NOT NULL,
	"paypal_plan_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "platform_plans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "paypal_webhook_events" (
	"event_id" text PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"subscription_id" text,
	"occurred_at" timestamp with time zone,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "paypal_webhook_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- Delete the platform-owned QBO connection and its firm-to-customer mappings.
-- The platform billing invoice table is deliberately retained for reconciliation.
DELETE FROM "qbo_oauth_states" WHERE "scope" = 'platform';--> statement-breakpoint
DELETE FROM "qbo_customer_links" WHERE "client_id" IS NULL;--> statement-breakpoint
DELETE FROM "qbo_connections" WHERE "scope" = 'platform';--> statement-breakpoint
ALTER TABLE "qbo_connections" DROP CONSTRAINT "qbo_connections_scope_firm_check";--> statement-breakpoint
ALTER TABLE "qbo_oauth_states" DROP CONSTRAINT "qbo_oauth_states_scope_firm_check";--> statement-breakpoint
DROP INDEX "qbo_connections_firm_unique";--> statement-breakpoint
DROP INDEX "qbo_connections_platform_unique";--> statement-breakpoint
DROP INDEX "qbo_customer_links_firm_client_unique";--> statement-breakpoint
DROP INDEX "qbo_customer_links_platform_firm_unique";--> statement-breakpoint
ALTER TABLE "qbo_connections" ALTER COLUMN "firm_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "qbo_oauth_states" ALTER COLUMN "firm_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "qbo_customer_links" ALTER COLUMN "client_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "qbo_connections" ALTER COLUMN "scope" TYPE text USING "scope"::text;--> statement-breakpoint
ALTER TABLE "qbo_oauth_states" ALTER COLUMN "scope" TYPE text USING "scope"::text;--> statement-breakpoint
DROP TYPE "public"."qbo_connection_scope";--> statement-breakpoint
CREATE TYPE "public"."qbo_connection_scope" AS ENUM('firm');--> statement-breakpoint
ALTER TABLE "qbo_connections" ALTER COLUMN "scope" TYPE "public"."qbo_connection_scope" USING "scope"::"public"."qbo_connection_scope";--> statement-breakpoint
ALTER TABLE "qbo_oauth_states" ALTER COLUMN "scope" TYPE "public"."qbo_connection_scope" USING "scope"::"public"."qbo_connection_scope";--> statement-breakpoint
ALTER TABLE "qbo_connections" ADD CONSTRAINT "qbo_connections_scope_firm_check" CHECK ("scope" = 'firm');--> statement-breakpoint
ALTER TABLE "qbo_oauth_states" ADD CONSTRAINT "qbo_oauth_states_scope_firm_check" CHECK ("scope" = 'firm');--> statement-breakpoint
CREATE UNIQUE INDEX "qbo_connections_firm_unique" ON "qbo_connections" USING btree ("firm_id");--> statement-breakpoint
CREATE UNIQUE INDEX "qbo_customer_links_firm_client_unique" ON "qbo_customer_links" USING btree ("firm_id", "client_id");--> statement-breakpoint
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', 'platform_plans', r);
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', 'paypal_webhook_events', r);
    END IF;
  END LOOP;
END
$$;
