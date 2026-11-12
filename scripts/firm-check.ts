/**
 * Read-only: lists firms and how many rows each owns, and flags any row without a firm.
 *   npm run firm:check
 * Prints counts only (no client data).
 */
import { sql } from "drizzle-orm";
import { openFromEnv } from "./env";

const TABLES = ["users", "clients", "client_assignments", "engagements", "tasks", "leads", "documents", "messages", "appointments", "announcements", "invoices", "subscriptions", "firm_profile", "audit_events"];

const { handle } = openFromEnv();
const rows = async <T>(q: ReturnType<typeof sql>) => ((await handle.db.execute(q)) as unknown as { rows: T[] }).rows;
try {
  const firms = await rows<{ id: string; name: string; slug: string; status: string }>(sql`select id, name, slug, status from firms order by created_at`);
  console.log(`firms: ${firms.length}`);
  for (const f of firms) console.log(`  - ${f.name} (/${f.slug}, ${f.status})`);
  for (const t of TABLES) {
    const [r] = await rows<{ total: number; unassigned: number }>(sql.raw(`select count(*)::int as total, count(*) filter (where firm_id is null)::int as unassigned from ${t}`));
    console.log(`${t.padEnd(20)} ${String(r!.total).padStart(5)} rows${r!.unassigned ? `  ⚠ ${r!.unassigned} without a firm` : ""}`);
  }
} finally {
  await handle.close();
}
