import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "@/db";
import type { Actor } from "@/lib/auth/actor";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { listAuditEvents } from "@/services/audit";
import { createClient, getClient, listClients, updateClient } from "@/services/clients";
import {
  createEngagement,
  createTask,
  getEngagement,
  listClientEngagements,
  listOpenEngagements,
  listStaff,
  setTaskStatus,
  updateEngagement,
} from "@/services/engagements";
import { getPortalOverview } from "@/services/portal";
import { createPortalInvitation } from "@/services/users";
import { createClientWithPortalUser, createTestDb, createUser } from "./helpers";

/**
 * Two clients (A and B), each with a portal login, an engagement, a
 * client-facing task and an internal task. Preparer A is assigned only to A.
 */
let h: DbHandle;
let admin: Actor, preparerA: Actor, preparerB: Actor, portalA: Actor, portalB: Actor;
let clientA: { id: string }, clientB: { id: string };
let engA: string, engB: string;
let clientTaskA: string, clientTaskB: string, internalTaskA: string;

beforeAll(async () => {
  h = await createTestDb();
  admin = await createUser(h.db, { role: "admin" });
  preparerA = await createUser(h.db, { role: "preparer", name: "Preparer A" });
  preparerB = await createUser(h.db, { role: "preparer", name: "Preparer B" });

  const a = await createClientWithPortalUser(h.db, admin, "Client A");
  const b = await createClientWithPortalUser(h.db, admin, "Client B");
  clientA = a.client;
  clientB = b.client;
  portalA = a.portalUser;
  portalB = b.portalUser;

  const base = { serviceType: "individual_tax", taxYear: 2026, status: "waiting_on_client", dueDate: "2027-04-15" };
  engA = (await createEngagement(h.db, admin, clientA.id, { ...base, title: "A 1040", ownerId: preparerA.userId })).id;
  engB = (await createEngagement(h.db, admin, clientB.id, { ...base, title: "B 1040", ownerId: preparerB.userId })).id;
  clientTaskA = (await createTask(h.db, admin, engA, { title: "A uploads W-2", isClientTask: true })).id;
  clientTaskB = (await createTask(h.db, admin, engB, { title: "B uploads W-2", isClientTask: true })).id;
  internalTaskA = (await createTask(h.db, admin, engA, { title: "INTERNAL: check prior-year carryover", isClientTask: false })).id;
});
afterAll(async () => {
  await h.close();
});

describe("client portal isolation", () => {
  it("shows a client only their own engagements and client-facing tasks", async () => {
    const overview = await getPortalOverview(h.db, portalA);
    expect(overview.clientName).toBe("Client A");
    expect(overview.engagements.map((e) => e.id)).toEqual([engA]);
    expect(overview.engagements[0]!.tasks.map((t) => t.id)).toEqual([clientTaskA]);
    const dump = JSON.stringify(overview);
    expect(dump).not.toContain("B 1040");
    expect(dump).not.toContain("INTERNAL");
  });

  it("does not expose internal fields in the portal view", async () => {
    const overview = await getPortalOverview(h.db, portalA);
    const keys = Object.keys(overview.engagements[0]!).sort();
    expect(keys).toEqual(["contactName", "dueDate", "id", "serviceType", "status", "tasks", "taxYear", "title"]);
    expect(Object.keys(overview.engagements[0]!.tasks[0]!).sort()).toEqual(["dueDate", "id", "status", "title"]);
  });

  it("does not let a client complete another client's task", async () => {
    await expect(setTaskStatus(h.db, portalA, clientTaskB, "done")).rejects.toBeInstanceOf(NotFoundError);
    const b = await getPortalOverview(h.db, portalB);
    expect(b.engagements[0]!.tasks[0]!.status).toBe("open");
  });

  it("does not let a client complete internal tasks or reopen tasks", async () => {
    await expect(setTaskStatus(h.db, portalA, internalTaskA, "done")).rejects.toBeInstanceOf(NotFoundError);
    await expect(setTaskStatus(h.db, portalA, clientTaskA, "open")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("lets a client complete their own client-facing task", async () => {
    const t = await setTaskStatus(h.db, portalA, clientTaskA, "done");
    expect(t.status).toBe("done");
    expect(t.completedById).toBe(portalA.userId);
  });

  it("blocks portal users from every staff service", async () => {
    const calls: [string, () => Promise<unknown>][] = [
      ["listClients", () => listClients(h.db, portalA)],
      ["getClient own", () => getClient(h.db, portalA, clientA.id)],
      ["getClient other", () => getClient(h.db, portalA, clientB.id)],
      ["createClient", () => createClient(h.db, portalA, { type: "individual", displayName: "X" })],
      ["updateClient", () => updateClient(h.db, portalA, clientA.id, { type: "individual", displayName: "X" })],
      ["listClientEngagements", () => listClientEngagements(h.db, portalA, clientA.id)],
      ["listOpenEngagements", () => listOpenEngagements(h.db, portalA)],
      ["getEngagement own", () => getEngagement(h.db, portalA, engA)],
      ["updateEngagement", () => updateEngagement(h.db, portalA, engA, {})],
      ["createEngagement", () => createEngagement(h.db, portalA, clientA.id, {})],
      ["createTask", () => createTask(h.db, portalA, engA, { title: "x" })],
      ["listStaff", () => listStaff(h.db, portalA)],
      ["createPortalInvitation", () => createPortalInvitation(h.db, portalA, clientA.id, { name: "x", email: "x@example.test" })],
      ["listAuditEvents", () => listAuditEvents(h.db, portalA, "client", clientA.id)],
    ];
    for (const [name, call] of calls) {
      await expect(call(), name).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it("refuses the portal view to staff and to client users with no client", async () => {
    await expect(getPortalOverview(h.db, admin)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getPortalOverview(h.db, { ...portalA, clientId: null })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("staff least privilege", () => {
  it("limits a preparer to assigned clients", async () => {
    const visible = (await listClients(h.db, preparerA)).map((c) => c.id);
    expect(visible).toContain(clientA.id);
    expect(visible).not.toContain(clientB.id);
    expect((await listOpenEngagements(h.db, preparerA)).map((e) => e.id)).toEqual([engA]);
  });

  it("returns not-found (not forbidden) for unassigned records, so IDs cannot be probed", async () => {
    const calls: [string, () => Promise<unknown>][] = [
      ["getClient", () => getClient(h.db, preparerA, clientB.id)],
      ["updateClient", () => updateClient(h.db, preparerA, clientB.id, { type: "individual", displayName: "Hijack" })],
      ["listClientEngagements", () => listClientEngagements(h.db, preparerA, clientB.id)],
      ["getEngagement", () => getEngagement(h.db, preparerA, engB)],
      ["updateEngagement", () => updateEngagement(h.db, preparerA, engB, {})],
      ["createEngagement", () => createEngagement(h.db, preparerA, clientB.id, { title: "x", serviceType: "other", ownerId: preparerA.userId })],
      ["createTask", () => createTask(h.db, preparerA, engB, { title: "x" })],
      ["setTaskStatus", () => setTaskStatus(h.db, preparerA, clientTaskB, "done")],
      ["createPortalInvitation", () => createPortalInvitation(h.db, preparerA, clientB.id, { name: "x", email: "y@example.test" })],
      ["malformed id", () => getClient(h.db, preparerA, "../../etc/passwd")],
      ["unknown id", () => getEngagement(h.db, preparerA, "00000000-0000-4000-8000-000000000000")],
    ];
    for (const [name, call] of calls) {
      await expect(call(), name).rejects.toBeInstanceOf(NotFoundError);
    }
  });

  it("lets partners and admins see every client", async () => {
    const partner = await createUser(h.db, { role: "partner" });
    const ids = (await listClients(h.db, partner)).map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining([clientA.id, clientB.id]));
  });

  it("restricts the audit log to admins", async () => {
    await expect(listAuditEvents(h.db, preparerA, "client", clientA.id)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await listAuditEvents(h.db, admin, "client", clientA.id)).length).toBeGreaterThan(0);
  });

  it("will not attach a portal login for one client to another client", async () => {
    const { userId } = await createPortalInvitation(h.db, admin, clientA.id, { name: "A Spouse", email: "spouse-a@example.test" });
    expect(userId).toBeTruthy();
    const err = await createPortalInvitation(h.db, admin, clientB.id, { name: "Imposter", email: "SPOUSE-A@example.test" }).catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    const staffEmail = await createPortalInvitation(h.db, admin, clientB.id, { name: "x", email: preparerA.email }).catch((e) => e);
    expect(staffEmail).toBeInstanceOf(ValidationError);
  });
});
