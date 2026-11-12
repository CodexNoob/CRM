-- Drop the old single-row key first (it carries the old primary key), then key the table by firm.
ALTER TABLE "firm_profile" DROP COLUMN "id";--> statement-breakpoint
ALTER TABLE "firm_profile" ADD PRIMARY KEY ("firm_id");
