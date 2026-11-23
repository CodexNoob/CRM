ALTER TABLE "leads" ADD COLUMN "gohighlevel_contact_id" text;
--> statement-breakpoint
CREATE UNIQUE INDEX "leads_firm_gohighlevel_contact_unique" ON "leads" USING btree ("firm_id", "gohighlevel_contact_id");
