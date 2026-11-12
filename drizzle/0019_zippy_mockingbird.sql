ALTER TABLE "tax_document_templates" DROP CONSTRAINT "tax_document_templates_created_by_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "tax_preparation_cases" DROP CONSTRAINT "tax_preparation_cases_created_by_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "tax_preparation_checklist_items" DROP CONSTRAINT "tax_preparation_checklist_document_fk";
--> statement-breakpoint
ALTER TABLE "tax_returns" DROP CONSTRAINT "tax_returns_created_by_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "tax_document_templates" ADD CONSTRAINT "tax_document_templates_firm_creator_fk" FOREIGN KEY ("firm_id","created_by_id") REFERENCES "public"."users"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_preparation_cases" ADD CONSTRAINT "tax_preparation_cases_firm_creator_fk" FOREIGN KEY ("firm_id","created_by_id") REFERENCES "public"."users"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_returns" ADD CONSTRAINT "tax_returns_firm_creator_fk" FOREIGN KEY ("firm_id","created_by_id") REFERENCES "public"."users"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_firm_id_id_unique" UNIQUE("firm_id","id");
--> statement-breakpoint
ALTER TABLE "tax_preparation_checklist_items" ADD CONSTRAINT "tax_preparation_checklist_firm_document_fk" FOREIGN KEY ("firm_id","document_id") REFERENCES "public"."documents"("firm_id","id") ON DELETE no action ON UPDATE no action;