/**
 * Read-only connectivity and hardening check for the configured database.
 *   npm run db:check            (uses DATABASE_URL)
 *   npm run db:check -- --direct (uses DIRECT_URL, as migrations do)
 * Prints no credentials.
 */
import { sql } from "drizzle-orm";
import { openFromEnv } from "./env";

const { url, handle } = openFromEnv({ direct: process.argv.includes("--direct") });
const host = url.startsWith("pglite:") ? url : new URL(url).hostname + ":" + (new URL(url).port || "5432");
const rows = async <T>(q: ReturnType<typeof sql>) => ((await handle.db.execute(q)) as unknown as { rows: T[] }).rows;

try {
  const [info] = await rows<{ user: string; version: string }>(
    sql`select current_user as user, split_part(version(), ' ', 2) as version`,
  );
  // TLS is enforced by the client config (see postgresPoolConfig); a failed handshake never reaches this line.
  const tls = url.startsWith("pglite:") ? "n/a (embedded)" : (process.env.DATABASE_SSL ?? "verify");
  console.log(`Connected to ${host} as ${info?.user} (PostgreSQL ${info?.version}), TLS mode: ${tls}`);

  const tables = await rows<{ name: string; rls: boolean }>(
    sql`select c.relname as name, c.relrowsecurity as rls from pg_class c
        join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' order by 1`,
  );
  console.log(tables.length ? `public tables: ${tables.map((t) => `${t.name}${t.rls ? "" : " (RLS OFF)"}`).join(", ")}` : "public schema has no tables");

  const apiGrants = await rows<{ grantee: string; n: number }>(
    sql`select grantee, count(*)::int as n from information_schema.role_table_grants
        where table_schema = 'public' and grantee in ('anon', 'authenticated') group by grantee`,
  );
  if (apiGrants.length) console.log(`WARNING: API roles still have table privileges: ${apiGrants.map((g) => `${g.grantee}=${g.n}`).join(", ")}`);

  const migrated = await rows<{ n: number }>(
    sql`select count(*)::int as n from information_schema.tables where table_schema = 'drizzle' and table_name = '__drizzle_migrations'`,
  );
  if (migrated[0]?.n) {
    const [m] = await rows<{ n: number }>(sql`select count(*)::int as n from drizzle.__drizzle_migrations`);
    console.log(`migrations applied: ${m?.n}`);
  } else {
    console.log("migrations applied: none");
  }
} catch (error) {
  // Drizzle wraps driver errors; the useful detail is on `cause`. Query params are never printed.
  const e = ((error as { cause?: unknown }).cause ?? error) as { code?: string; message?: string };
  console.error(`Database check failed: ${e.code ?? ""} ${e.message ?? String(error)}`);
  process.exitCode = 1;
} finally {
  await handle.close();
}
