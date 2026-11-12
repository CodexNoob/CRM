import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DbHandle } from "@/db";
import { auditEvents } from "@/db/schema";
import { IntegrationNotConfiguredError, ValidationError } from "@/lib/errors";
import { getAccountingProvider } from "@/integrations/qbo";
import { createClient, getClient, listClients, updateClient } from "@/services/clients";
import {
  createEngagement,
  createTask,
  getEngagement,
  listClientEngagements,
  listOpenEngagements,
  setTaskStatus,
  updateEngagement,
} from "@/services/engagements";
import { createTestDb, createUser } from "./helpers";

let h: DbHandle;
beforeAll(async () => {
  h = await createTestDb();
});
afterAll(async () => {
  await h.close();
});

describe("clients", () => {
  it("creates, reads, updates and searches client records", async () => {
    const admin = await createUser(h.db, { role: "admin" });
    const created = await createClient(h.db, admin, {
      type: "household",
      displayName: "  Rivera Household ",
      email: "Rivera@Example.test",
      phone: "(555) 010-2000",
    });
    expect(created.displayName).toBe("Rivera Household");
    expect(created.email).toBe("rivera@example.test");

    const updated = await updateClient(h.db, admin, created.id, {
      type: "household",
      displayName: "Rivera Family",
      email: "",
      phone: "(555) 010-2000",
      status: "active",
    });
    expect(updated.displayName).toBe("Rivera Family");
    expect(updated.email).toBeNull();
    expect((await getClient(h.db, admin, created.id)).displayName).toBe("Rivera Family");

    expect((await listClients(h.db, admin, { q: "rivera" })).map((c) => c.id)).toContain(created.id);
    expect((await listClients(h.db, admin, { q: "010-2000" })).map((c) => c.id)).toContain(created.id);
    expect(await listClients(h.db, admin, { q: "zzz-no-match" })).toEqual([]);
  });

  it("treats search wildcards literally", async () => {
    const admin = await createUser(h.db, { role: "admin" });
    await createClient(h.db, admin, { type: "individual", displayName: "Wildcard Test" });
    expect(await listClients(h.db, admin, { q: "%" })).toEqual([]);
    expect(await listClients(h.db, admin, { q: "_" })).toEqual([]);
  });

  it("validates client input with per-field messages", async () => {
    const admin = await createUser(h.db, { role: "admin" });
    const err = await createClient(h.db, admin, { type: "robot", displayName: "", email: "not-an-email" }).catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(Object.keys((err as ValidationError).fieldErrors).sort()).toEqual(["displayName", "email", "type"]);
  });

  it("records audit events with changed field names but not values", async () => {
    const admin = await createUser(h.db, { role: "admin" });
    const c = await createClient(h.db, admin, { type: "individual", displayName: "Audit Person", email: "a@example.test" });
    await updateClient(h.db, admin, c.id, { type: "individual", displayName: "Audit Person", email: "secret-new@example.test" });
    const events = await h.db.select().from(auditEvents).where(eq(auditEvents.entityId, c.id));
    // Creating a client also records the creator's access grant (client.assign).
    expect(events.map((e) => e.action).sort()).toEqual(["client.assign", "client.create", "client.update"]);
    const update = events.find((e) => e.action === "client.update")!;
    expect(update.metadata).toEqual({ changedFields: ["email"] });
    expect(JSON.stringify(events)).not.toContain("secret-new@example.test");
  });
});

describe("engagements and tasks", () => {
  it("creates an engagement with owner, due date and status, then tasks", async () => {
    const admin = await createUser(h.db, { role: "admin" });
    const preparer = await createUser(h.db, { role: "preparer", name: "Pat Preparer" });
    const client = await createClient(h.db, admin, { type: "individual", displayName: "Jordan Lee" });

    const engagement = await createEngagement(h.db, admin, client.id, {
      title: "2026 Form 1040",
      serviceType: "individual_tax",
      taxYear: "2026",
      status: "waiting_on_client",
      ownerId: preparer.userId,
      dueDate: "2027-04-15",
    });
    expect(engagement.taxYear).toBe(2026);
    expect(engagement.dueDate).toBe("2027-04-15");

    const clientTask = await createTask(h.db, admin, engagement.id, { title: "Upload your W-2s", isClientTask: "on" });
    const staffTask = await createTask(h.db, admin, engagement.id, {
      title: "Enter W-2 data",
      assigneeId: preparer.userId,
      dueDate: "2027-03-01",
    });
    expect(clientTask.isClientTask).toBe(true);
    expect(staffTask.isClientTask).toBe(false);

    const detail = await getEngagement(h.db, admin, engagement.id);
    expect(detail.ownerName).toBe("Pat Preparer");
    expect(detail.tasks).toHaveLength(2);

    // The owner was given access to the client automatically.
    expect((await listClients(h.db, preparer)).map((c) => c.id)).toContain(client.id);
    expect((await listOpenEngagements(h.db, preparer, { ownedByMe: true })).map((e) => e.id)).toContain(engagement.id);

    const updated = await updateEngagement(h.db, preparer, engagement.id, {
      title: "2026 Form 1040",
      serviceType: "individual_tax",
      taxYear: "2026",
      status: "in_progress",
      ownerId: preparer.userId,
      dueDate: "2027-04-15",
    });
    expect(updated.status).toBe("in_progress");

    const done = await setTaskStatus(h.db, preparer, staffTask.id, "done");
    expect(done.status).toBe("done");
    expect(done.completedById).toBe(preparer.userId);
    expect((await listClientEngagements(h.db, admin, client.id))[0]!.openTaskCount).toBe(1);
  });

  it("rejects invalid engagement input", async () => {
    const admin = await createUser(h.db, { role: "admin" });
    const portalUser = await createUser(h.db, { role: "client" });
    const client = await createClient(h.db, admin, { type: "individual", displayName: "Bad Input" });
    const base = { title: "x", serviceType: "individual_tax", ownerId: admin.userId };

    for (const [patch, field] of [
      [{ title: "" }, "title"],
      [{ dueDate: "2027-02-30" }, "dueDate"],
      [{ dueDate: "15/04/2027" }, "dueDate"],
      [{ taxYear: "1850" }, "taxYear"],
      [{ serviceType: "magic" }, "serviceType"],
      [{ ownerId: "not-a-uuid" }, "ownerId"],
      [{ ownerId: portalUser.userId }, "ownerId"], // clients cannot own engagements
    ] as const) {
      const err = await createEngagement(h.db, admin, client.id, { ...base, ...patch }).catch((e) => e);
      expect(err, JSON.stringify(patch)).toBeInstanceOf(ValidationError);
      expect(Object.keys((err as ValidationError).fieldErrors)).toContain(field);
    }
  });
});

describe("QuickBooks Online boundary", () => {
  it("fails explicitly instead of returning fake invoices", async () => {
    const unconfigured = getAccountingProvider({});
    expect(unconfigured.isConfigured).toBe(false);
    await expect(unconfigured.listInvoices("123")).rejects.toBeInstanceOf(IntegrationNotConfiguredError);

    const withCredentials = getAccountingProvider({ clientId: "a", clientSecret: "b", redirectUri: "https://x.test/cb" });
    await expect(withCredentials.listInvoices("123")).rejects.toThrow(/not been implemented/);
  });
});
