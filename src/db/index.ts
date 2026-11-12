import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { Pool, type PoolConfig } from "pg";
import * as schema from "./schema";

/** Database handle used by every service. Works for both PostgreSQL and embedded PGlite. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface DbHandle {
  db: Db;
  migrate: () => Promise<void>;
  close: () => Promise<void>;
}

const MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle");

/**
 * Opens a database from a URL:
 *  - `postgres://…` / `postgresql://…`  → PostgreSQL via node-postgres
 *  - `pglite:memory`                     → in-memory embedded Postgres (tests)
 *  - `pglite:<dir>`                      → embedded Postgres persisted to <dir> (local dev only)
 */
export function openDatabase(url: string): DbHandle {
  if (url.startsWith("pglite:")) {
    const location = url.slice("pglite:".length);
    if (location !== "memory") mkdirSync(path.dirname(path.resolve(location)), { recursive: true });
    const client = location === "memory" ? new PGlite() : new PGlite(location);
    const db = drizzlePglite(client, { schema }) as unknown as Db;
    return {
      db,
      migrate: () => migratePglite(db as never, { migrationsFolder: MIGRATIONS_FOLDER }),
      close: () => client.close(),
    };
  }
  if (url.startsWith("postgres://") || url.startsWith("postgresql://")) {
    const pool = new Pool(postgresPoolConfig(url));
    const db = drizzlePg(pool, { schema }) as unknown as Db;
    return {
      db,
      migrate: () => migratePg(db as never, { migrationsFolder: MIGRATIONS_FOLDER }),
      close: () => pool.end(),
    };
  }
  throw new Error("DATABASE_URL must start with postgres://, postgresql:// or pglite:");
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
/** URL parameters that would silently override the TLS settings below, or that node-postgres does not understand. */
const STRIPPED_PARAMS = ["sslmode", "ssl", "sslrootcert", "sslcert", "sslkey", "uselibpqcompat", "pgbouncer"];

/**
 * TLS policy for PostgreSQL (env DATABASE_SSL):
 *  - "verify" (default for remote hosts): encrypted AND the server certificate is verified,
 *    using DATABASE_SSL_CA_PATH when the provider uses its own CA (Supabase does).
 *  - "no-verify": encrypted but the server is not authenticated. Temporary use only.
 *  - "disable": plaintext, allowed only for localhost.
 */
export function postgresPoolConfig(rawUrl: string, env: Record<string, string | undefined> = process.env): PoolConfig {
  const url = new URL(rawUrl);
  for (const p of STRIPPED_PARAMS) url.searchParams.delete(p);
  const isLocal = LOCAL_HOSTS.has(url.hostname);
  const mode = env.DATABASE_SSL ?? (isLocal ? "disable" : "verify");
  const max = Number(env.DATABASE_POOL_MAX ?? 10);

  let ssl: PoolConfig["ssl"];
  if (mode === "disable") {
    if (!isLocal) throw new Error("DATABASE_SSL=disable is only allowed for a database on localhost.");
    ssl = false;
  } else if (mode === "no-verify") {
    console.warn("DATABASE_SSL=no-verify: the connection is encrypted but the database server is NOT authenticated.");
    ssl = { rejectUnauthorized: false };
  } else if (mode === "verify") {
    const caPath = env.DATABASE_SSL_CA_PATH;
    ssl = { rejectUnauthorized: true, ...(caPath ? { ca: readFileSync(path.resolve(caPath), "utf8") } : {}) };
  } else {
    throw new Error("DATABASE_SSL must be one of: verify, no-verify, disable.");
  }

  return { connectionString: url.toString(), ssl, max: Number.isFinite(max) && max > 0 ? max : 10 };
}

const globalForDb = globalThis as unknown as { __crmDb?: DbHandle };

/** Process-wide database for the running app (survives dev hot reloads). */
export function getDb(): Db {
  if (!globalForDb.__crmDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local.");
    globalForDb.__crmDb = openDatabase(url);
  }
  return globalForDb.__crmDb.db;
}

export { schema };
