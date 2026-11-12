import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { postgresPoolConfig, type DbHandle } from "@/db";
import { createTestDb } from "./helpers";

let h: DbHandle;
beforeAll(async () => {
  h = await createTestDb();
});
afterAll(async () => {
  await h.close();
});

describe("database hardening", () => {
  it("has row-level security enabled on every table in the public schema", async () => {
    const result = await h.db.execute(
      sql`select c.relname as name, c.relrowsecurity as rls
          from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind = 'r'`,
    );
    const rows = (result as unknown as { rows: { name: string; rls: boolean }[] }).rows;
    expect(rows.length).toBeGreaterThanOrEqual(8);
    // A new table without `.enableRLS()` in schema.ts fails here.
    expect(rows.filter((r) => !r.rls).map((r) => r.name)).toEqual([]);
  });
});

describe("PostgreSQL TLS policy", () => {
  const remote = "postgresql://u:p%21@db.example.com:5432/postgres?sslmode=disable&pgbouncer=true";

  it("verifies the server certificate for remote hosts by default and strips overriding URL params", () => {
    const cfg = postgresPoolConfig(remote, {});
    expect(cfg.ssl).toEqual({ rejectUnauthorized: true });
    expect(cfg.connectionString).toBe("postgresql://u:p%21@db.example.com:5432/postgres");
  });

  it("refuses plaintext to a remote host", () => {
    expect(() => postgresPoolConfig(remote, { DATABASE_SSL: "disable" })).toThrow(/localhost/);
    expect(() => postgresPoolConfig(remote, { DATABASE_SSL: "maybe" })).toThrow();
  });

  it("allows plaintext for localhost only by default", () => {
    expect(postgresPoolConfig("postgres://u:p@localhost:5432/db", {}).ssl).toBe(false);
  });
});
