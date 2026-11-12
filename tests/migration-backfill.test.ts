import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The multi-firm migration (0011+) runs against databases that already hold a
 * single firm's data. This replays the migrations up to 0010 on an empty database,
 * inserts single-firm data, then applies the rest and checks it all moved into firm #1.
 */
const dir = join(__dirname, "..", "drizzle");
const files = readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
const statements = (file: string) =>
  readFileSync(join(dir, file), "utf8")
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);

let pg: PGlite;
const q = async <T = Record<string, unknown>>(sql: string) => (await pg.query<T>(sql)).rows;

beforeAll(async () => {
  pg = new PGlite();
  for (const f of files.filter((f) => f < "0011")) for (const s of statements(f)) await pg.exec(s);

  await pg.exec(`
    insert into firm_profile (id, name) values (1, 'Duot Tax Services');
    insert into clients (id, type, display_name, created_by_id) values ('11111111-1111-4111-8111-111111111111', 'individual', 'Jordan', '22222222-2222-4222-8222-222222222222');
    insert into users (id, email, name, role) values ('22222222-2222-4222-8222-222222222222', 'admin@example.test', 'Admin', 'admin');
    insert into users (id, email, name, role, client_id) values ('33333333-3333-4333-8333-333333333333', 'client@example.test', 'Jordan', 'client', '11111111-1111-4111-8111-111111111111');
    insert into client_assignments (client_id, user_id) values ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222');
    insert into engagements (id, client_id, title, service_type, owner_id) values ('44444444-4444-4444-8444-444444444444', '11111111-1111-4111-8111-111111111111', '1040', 'individual_tax', '22222222-2222-4222-8222-222222222222');
    insert into tasks (engagement_id, title, assignee_id) values ('44444444-4444-4444-8444-444444444444', 'Collect W-2', '22222222-2222-4222-8222-222222222222');
    insert into tasks (engagement_id, title, status) values ('44444444-4444-4444-8444-444444444444', 'Done already', 'done');
    insert into users (id, email, name, role) values ('66666666-6666-4666-8666-666666666666', 'partner@example.test', 'Pat Partner', 'partner');
    insert into users (id, email, name, role) values ('77777777-7777-4777-8777-777777777777', 'prep@example.test', 'Pip Preparer', 'preparer');
    insert into leads (name, source) values ('Website visitor', 'website');
    insert into messages (client_id, from_client, body) values ('11111111-1111-4111-8111-111111111111', true, 'Hello');
    insert into announcements (title, body, published_on) values ('Open', 'We are open', '2026-01-01');
    insert into audit_events (action, entity_type) values ('client.create', 'client');
    insert into invoices (client_id, title, items, total_cents, recipient_email) values ('11111111-1111-4111-8111-111111111111', 'Prep', '[]', 100, 'a@example.test');
  `);

  for (const f of files.filter((f) => f >= "0011")) for (const s of statements(f)) await pg.exec(s);
});

afterAll(async () => {
  await pg.close();
});

describe("practice-workflow migration (0016) on existing data", () => {
  it("renames roles without losing access", async () => {
    const roles = await q<{ email: string; role: string }>("select email, role::text from users order by email");
    expect(roles).toEqual([
      { email: "admin@example.test", role: "admin" },
      { email: "client@example.test", role: "client" },
      { email: "partner@example.test", role: "manager" },
      { email: "prep@example.test", role: "employee" },
    ]);
  });

  it("maps task statuses and links tasks to their engagement's client", async () => {
    const tasks = await q<{ title: string; status: string; client_id: string; task_number: number }>("select title, status::text, client_id, task_number from tasks order by task_number");
    expect(tasks.map((t) => [t.title, t.status])).toEqual([
      ["Collect W-2", "todo"],
      ["Done already", "completed"],
    ]);
    expect(tasks.every((t) => t.client_id === "11111111-1111-4111-8111-111111111111")).toBe(true);
  });

  it("numbers existing records per firm and seeds the counters", async () => {
    expect((await q<{ n: number }>("select client_number n from clients"))[0]!.n).toBe(1);
    const counters = await q<{ kind: string; value: number }>("select kind, value from firm_counters order by kind");
    expect(counters).toEqual([
      { kind: "client", value: 1 },
      { kind: "engagement", value: 1 },
      { kind: "lead", value: 1 },
      { kind: "task", value: 2 },
    ]);
  });

  it("adds the engagement manager to the engagement team", async () => {
    const team = await q<{ user_id: string; role: string }>("select user_id, role::text from engagement_team");
    expect(team).toEqual([{ user_id: "22222222-2222-4222-8222-222222222222", role: "manager" }]);
  });
});

describe("multi-firm migration on existing single-firm data", () => {
  it("creates exactly one active firm named after the firm profile", async () => {
    const firms = await q<{ name: string; slug: string; status: string }>("select name, slug, status from firms");
    expect(firms).toEqual([{ name: "Duot Tax Services", slug: "my-firm", status: "active" }]);
  });

  it("assigns every existing row to that firm and leaves no nulls", async () => {
    const [{ id }] = (await q<{ id: string }>("select id from firms")) as [{ id: string }];
    for (const t of ["clients", "users", "client_assignments", "engagements", "tasks", "leads", "messages", "announcements", "audit_events", "invoices", "firm_profile"]) {
      const rows = await q<{ n: number; mine: number }>(`select count(*)::int n, count(*) filter (where firm_id = '${id}')::int mine from ${t}`);
      expect({ t, ...rows[0] }).toEqual({ t, n: rows[0]!.n, mine: rows[0]!.n });
      expect(rows[0]!.n).toBeGreaterThan(0);
    }
  });

  it("keys the firm profile by firm", async () => {
    const cols = await q<{ column_name: string }>("select column_name from information_schema.columns where table_name = 'firm_profile' and column_name = 'id'");
    expect(cols).toHaveLength(0);
  });

  it("rejects linking a row to another firm's client", async () => {
    await pg.exec("insert into firms (id, name, slug) values ('55555555-5555-4555-8555-555555555555', 'Other', 'other')");
    await expect(
      pg.exec(
        "insert into engagements (firm_id, client_id, title, service_type, owner_id) values ('55555555-5555-4555-8555-555555555555', '11111111-1111-4111-8111-111111111111', 'x', 'other', '22222222-2222-4222-8222-222222222222')",
      ),
    ).rejects.toThrow(/foreign key/i);
  });
});
