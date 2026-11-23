ALTER TABLE "firms" ADD COLUMN "lead_assignment_cursor" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "lead_id" uuid;
--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_firm_id_id_unique" UNIQUE("firm_id", "id");
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_firm_lead_fk" FOREIGN KEY ("firm_id", "lead_id") REFERENCES "leads"("firm_id", "id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "tasks_lead_idx" ON "tasks" USING btree ("lead_id");
