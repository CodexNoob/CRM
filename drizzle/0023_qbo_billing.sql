-- Preserve old external references for reconciliation, but disconnect all old payment links.
ALTER TABLE "firms" RENAME COLUMN "paypal_subscription_id" TO "legacy_external_subscription_id";--> statement-breakpoint
ALTER INDEX "firms_paypal_subscription_unique" RENAME TO "firms_legacy_subscription_unique";--> statement-breakpoint
ALTER TABLE "invoices" RENAME COLUMN "paypal_invoice_id" TO "legacy_external_invoice_id";--> statement-breakpoint
ALTER TABLE "invoices" RENAME COLUMN "paypal_invoice_number" TO "legacy_external_invoice_number";--> statement-breakpoint
ALTER INDEX "invoices_paypal_id_unique" RENAME TO "invoices_legacy_external_id_unique";--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "qbo_invoice_id" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "qbo_invoice_number" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "qbo_request_id" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "legacy_billing" boolean NOT NULL DEFAULT true;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "subscription_id" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "billing_period_start" date;--> statement-breakpoint
ALTER TABLE "invoices" ALTER COLUMN "legacy_billing" SET DEFAULT false;--> statement-breakpoint
UPDATE "invoices" SET "pay_url" = NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_qbo_id_unique" ON "invoices" USING btree ("firm_id", "qbo_invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_qbo_request_unique" ON "invoices" USING btree ("qbo_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_subscription_period_unique" ON "invoices" USING btree ("subscription_id", "billing_period_start") WHERE "subscription_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" RENAME COLUMN "paypal_plan_id" TO "legacy_external_plan_id";--> statement-breakpoint
ALTER TABLE "subscriptions" RENAME COLUMN "paypal_subscription_id" TO "legacy_external_subscription_id";--> statement-breakpoint
ALTER INDEX "subscriptions_paypal_id_unique" RENAME TO "subscriptions_legacy_external_id_unique";--> statement-breakpoint
ALTER TABLE "subscriptions" ALTER COLUMN "legacy_external_plan_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "legacy_billing" boolean NOT NULL DEFAULT true;--> statement-breakpoint
ALTER TABLE "subscriptions" ALTER COLUMN "legacy_billing" SET DEFAULT false;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE SET NULL ON UPDATE NO ACTION;--> statement-breakpoint
DROP TABLE "platform_plans";--> statement-breakpoint
CREATE TYPE "public"."qbo_connection_scope" AS ENUM('firm', 'platform');--> statement-breakpoint
CREATE TYPE "public"."qbo_connection_status" AS ENUM('connected', 'reauthorization_required');--> statement-breakpoint
CREATE TABLE "qbo_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" "qbo_connection_scope" NOT NULL,
	"firm_id" uuid,
	"realm_id" text NOT NULL,
	"company_name" text NOT NULL,
	"access_token_encrypted" text NOT NULL,
	"refresh_token_encrypted" text NOT NULL,
	"access_expires_at" timestamp with time zone NOT NULL,
	"refresh_expires_at" timestamp with time zone NOT NULL,
	"status" "qbo_connection_status" DEFAULT 'connected' NOT NULL,
	"default_item_id" text,
	"verified_at" timestamp with time zone,
	"connected_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "qbo_connections_scope_firm_check" CHECK (("scope" = 'platform' AND "firm_id" IS NULL) OR ("scope" = 'firm' AND "firm_id" IS NOT NULL))
);--> statement-breakpoint
ALTER TABLE "qbo_connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "qbo_connections" ADD CONSTRAINT "qbo_connections_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE CASCADE ON UPDATE NO ACTION;--> statement-breakpoint
ALTER TABLE "qbo_connections" ADD CONSTRAINT "qbo_connections_connected_by_id_users_id_fk" FOREIGN KEY ("connected_by_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;--> statement-breakpoint
CREATE UNIQUE INDEX "qbo_connections_firm_unique" ON "qbo_connections" USING btree ("firm_id") WHERE "scope" = 'firm';--> statement-breakpoint
CREATE UNIQUE INDEX "qbo_connections_platform_unique" ON "qbo_connections" USING btree ("scope") WHERE "scope" = 'platform';--> statement-breakpoint
CREATE TABLE "qbo_oauth_states" (
	"state_hash" text PRIMARY KEY NOT NULL,
	"scope" "qbo_connection_scope" NOT NULL,
	"firm_id" uuid,
	"created_by_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "qbo_oauth_states_scope_firm_check" CHECK (("scope" = 'platform' AND "firm_id" IS NULL) OR ("scope" = 'firm' AND "firm_id" IS NOT NULL))
);--> statement-breakpoint
ALTER TABLE "qbo_oauth_states" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "qbo_oauth_states" ADD CONSTRAINT "qbo_oauth_states_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE CASCADE ON UPDATE NO ACTION;--> statement-breakpoint
ALTER TABLE "qbo_oauth_states" ADD CONSTRAINT "qbo_oauth_states_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;--> statement-breakpoint
CREATE TABLE "qbo_customer_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"firm_id" uuid NOT NULL,
	"client_id" uuid,
	"qbo_customer_id" text NOT NULL,
	"display_name" text NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "qbo_customer_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "qbo_customer_links" ADD CONSTRAINT "qbo_customer_links_connection_id_qbo_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."qbo_connections"("id") ON DELETE CASCADE ON UPDATE NO ACTION;--> statement-breakpoint
ALTER TABLE "qbo_customer_links" ADD CONSTRAINT "qbo_customer_links_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE CASCADE ON UPDATE NO ACTION;--> statement-breakpoint
ALTER TABLE "qbo_customer_links" ADD CONSTRAINT "qbo_customer_links_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE ON UPDATE NO ACTION;--> statement-breakpoint
ALTER TABLE "qbo_customer_links" ADD CONSTRAINT "qbo_customer_links_firm_client_fk" FOREIGN KEY ("firm_id", "client_id") REFERENCES "public"."clients"("firm_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;--> statement-breakpoint
ALTER TABLE "qbo_customer_links" ADD CONSTRAINT "qbo_customer_links_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;--> statement-breakpoint
CREATE UNIQUE INDEX "qbo_customer_links_connection_customer_unique" ON "qbo_customer_links" USING btree ("connection_id", "qbo_customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "qbo_customer_links_firm_client_unique" ON "qbo_customer_links" USING btree ("firm_id", "client_id") WHERE "client_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "qbo_customer_links_platform_firm_unique" ON "qbo_customer_links" USING btree ("firm_id") WHERE "client_id" IS NULL;--> statement-breakpoint
CREATE TABLE "platform_billing_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"interval" "billing_interval" NOT NULL,
	"period_start" date NOT NULL,
	"total_cents" integer NOT NULL,
	"currency" text NOT NULL,
	"due_date" date,
	"status" "invoice_status" DEFAULT 'draft' NOT NULL,
	"qbo_invoice_id" text,
	"qbo_invoice_number" text,
	"qbo_request_id" text NOT NULL,
	"payment_url" text,
	"sent_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"synced_at" timestamp with time zone,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "platform_billing_invoices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "platform_billing_invoices" ADD CONSTRAINT "platform_billing_invoices_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;--> statement-breakpoint
ALTER TABLE "platform_billing_invoices" ADD CONSTRAINT "platform_billing_invoices_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;--> statement-breakpoint
CREATE UNIQUE INDEX "platform_billing_firm_period_unique" ON "platform_billing_invoices" USING btree ("firm_id", "period_start");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_billing_qbo_id_unique" ON "platform_billing_invoices" USING btree ("qbo_invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_billing_request_unique" ON "platform_billing_invoices" USING btree ("qbo_request_id");--> statement-breakpoint
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', 'qbo_connections', r);
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', 'qbo_oauth_states', r);
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', 'qbo_customer_links', r);
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', 'platform_billing_invoices', r);
    END IF;
  END LOOP;
END
$$;
