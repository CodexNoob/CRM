CREATE TABLE "platform_plans" (
	"interval" text PRIMARY KEY NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text NOT NULL,
	"paypal_plan_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform_plans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "firms" ADD COLUMN "billing_interval" text;--> statement-breakpoint
ALTER TABLE "firms" ADD COLUMN "paypal_subscription_id" text;--> statement-breakpoint
ALTER TABLE "firms" ADD COLUMN "next_billing_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "firms" ADD COLUMN "billing_synced_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "firms_paypal_subscription_unique" ON "firms" USING btree ("paypal_subscription_id");