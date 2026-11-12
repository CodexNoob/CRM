import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "@/db";
import type { Actor } from "@/lib/auth/actor";
import { ForbiddenError } from "@/lib/errors";
import { findPlanned, navForRole } from "@/components/staff/nav-config";
import { listRecentActivity } from "@/services/audit";
import { createClient } from "@/services/clients";
import { createEngagement, createTask } from "@/services/engagements";
import { countMyOpenTasks, listTasks } from "@/services/tasks";
import { createTestDb, createUser } from "./helpers";

let h: DbHandle;
let admin: Actor, prepA: Actor, prepB: Actor;

beforeAll(async () => {
  h = await createTestDb();
  admin = await createUser(h.db, { role: "admin", name: "Ada Admin" });
  prepA = await createUser(h.db, { role: "employee" });
  prepB = await createUser(h.db, { role: "employee" });
  const a = await createClient(h.db, admin, { type: "individual", displayName: "Alpha" });
  const b = await createClient(h.db, admin, { type: "individual", displayName: "Beta" });
  const ea = await createEngagement(h.db, admin, a.id, { title: "A", serviceType: "other", ownerId: prepA.userId });
  const eb = await createEngagement(h.db, admin, b.id, { title: "B", serviceType: "other", ownerId: prepB.userId });
  await createTask(h.db, admin, ea.id, { title: "A internal", assigneeId: prepA.userId });
  await createTask(h.db, admin, ea.id, { title: "A client task", isClientTask: true });
  await createTask(h.db, admin, eb.id, { title: "B internal", assigneeId: prepB.userId });
});
afterAll(async () => {
  await h.close();
});

describe("tasks module", () => {
  it("lists only tasks on clients the actor can see", async () => {
    expect((await listTasks(h.db, prepA)).map((t) => t.title).sort()).toEqual(["A client task", "A internal"]);
    expect((await listTasks(h.db, prepA, { mine: true })).map((t) => t.title)).toEqual(["A internal"]);
    expect((await listTasks(h.db, admin)).length).toBe(3);
    expect(await countMyOpenTasks(h.db, prepB)).toBe(1);
  });

  it("is staff-only", async () => {
    const client = await createUser(h.db, { role: "client" });
    await expect(listTasks(h.db, client)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(countMyOpenTasks(h.db, client)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("activity log", () => {
  it("is admin-only and names the actor without exposing metadata", async () => {
    const rows = await listRecentActivity(h.db, admin);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).not.toHaveProperty("metadata");
    expect(rows.some((r) => r.actorName === "Ada Admin" && r.action === "client.create")).toBe(true);
    await expect(listRecentActivity(h.db, prepA)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("navigation", () => {
  it("hides administration items from non-admins and resolves planned modules", () => {
    const slugs = (admin: boolean) => navForRole(admin).flatMap((s) => s.items.map((i) => i.slug));
    expect(slugs(true)).toEqual(expect.arrayContaining(["team", "activity", "settings"]));
    expect(slugs(false)).not.toEqual(expect.arrayContaining(["team"]));
    expect(slugs(false)).not.toContain("activity");
    expect(findPlanned("e-signatures")?.label).toBe("E-Signatures");
    expect(findPlanned("e-signatures")?.needs).toMatch(/provider/);
    for (const built of ["tax-returns", "tax-preparation", "bookkeeping", "client-portal", "reports", "integrations", "settings"]) {
      expect(findPlanned(built), built).toBeUndefined();
    }
    expect(findPlanned("documents")).toBeUndefined(); // built in Phase 1
    expect(findPlanned("clients")).toBeUndefined(); // live modules have real pages
    expect(findPlanned("../etc")).toBeUndefined();
  });
});
