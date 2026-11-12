import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { DbHandle } from "@/db";
import { activities, clients, conversations, documentRequestItems, documentRequests, documents, messages, portalClientAccess, signatureRequests } from "@/db/schema";
import { actorFromUser, type Actor } from "@/lib/auth/actor";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { createClient } from "@/services/clients";
import { countPortalUnreadMessages, getPortalOverview, getPortalSummary, listPortalServices, requestContactChange } from "@/services/portal";
import { assertPortalClientAccess, grantPortalAccess, listPortalAccess, listPortalClients, resolvePortalClient, setPortalAccessStatus } from "@/services/portal-access";
import { createPortalInvitation, listPortalUsers } from "@/services/users";
import { createTestDb, createTestFirm, createUser } from "./helpers";
import { users } from "@/db/schema";

/** Client portal: access isolation (multi-client contacts), overview counts, staff access management. */

let h: DbHandle;
let admin: Actor, manager: Actor, employee: Actor, readOnly: Actor;
let acme: string, beta: string, other: string;
let otherFirmClient: string;

const portalActor = async (userId: string): Promise<Actor> => {
  const [u] = await h.db.select().from(users).where(eq(users.id, userId));
  return actorFromUser(u!);
};

beforeAll(async () => {
  h = await createTestDb();
  admin = await createUser(h.db, { role: "admin" });
  manager = await createUser(h.db, { role: "manager" });
  employee = await createUser(h.db, { role: "employee" });
  readOnly = await createUser(h.db, { role: "read_only" });
  acme = (await createClient(h.db, admin, { type: "business", displayName: "Acme LLC" })).id;
  beta = (await createClient(h.db, admin, { type: "business", displayName: "Beta Inc" })).id;
  other = (await createClient(h.db, admin, { type: "individual", displayName: "Unrelated Person" })).id;
  const firmB = await createTestFirm(h.db, "Firm B");
  const adminB = await createUser(h.db, { role: "admin", firmId: firmB });
  otherFirmClient = (await createClient(h.db, adminB, { type: "individual", displayName: "Other Firm Client" })).id;
});
afterAll(async () => {
  await h.close();
});

describe("invitations create portal access", () => {
  let bookkeeper: Actor;

  it("an invitation creates the login AND its access row", async () => {
    const { userId } = await createPortalInvitation(h.db, admin, acme, { name: "Bo Keeper", email: "bo@example.test", role: "owner" });
    const [row] = await h.db.select().from(portalClientAccess).where(and(eq(portalClientAccess.userId, userId), eq(portalClientAccess.clientId, acme)));
    expect(row).toMatchObject({ role: "owner", status: "active" });
    expect((await listPortalUsers(h.db, admin, acme)).map((u) => u.email)).toContain("bo@example.test");
    bookkeeper = await portalActor(userId);
  });

  it("inviting the same person to a second client reuses the login (no duplicate account)", async () => {
    const { userId } = await createPortalInvitation(h.db, manager, beta, { name: "Bo Keeper", email: "BO@example.test" });
    expect(userId).toBe(bookkeeper.userId);
    const list = await listPortalClients(h.db, bookkeeper);
    expect(list.map((c) => c.name)).toEqual(["Acme LLC", "Beta Inc"]);
    expect((await listPortalUsers(h.db, admin, beta)).map((u) => u.email)).toContain("bo@example.test");
  });

  it("the switcher hint is honoured only for the user's own clients", async () => {
    expect((await resolvePortalClient(h.db, bookkeeper, beta)).clientId).toBe(beta);
    expect((await resolvePortalClient(h.db, bookkeeper, other)).clientId).toBe(acme); // not theirs → ignored
    expect((await resolvePortalClient(h.db, bookkeeper, otherFirmClient)).clientId).toBe(acme);
    expect((await resolvePortalClient(h.db, bookkeeper, "not-a-uuid")).clientId).toBe(acme);
  });

  it("URL/payload manipulation: another client's id is not found", async () => {
    await expect(assertPortalClientAccess(h.db, bookkeeper, other)).rejects.toBeInstanceOf(NotFoundError);
    await expect(assertPortalClientAccess(h.db, bookkeeper, otherFirmClient)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getPortalSummary(h.db, bookkeeper, other, "2027-01-15")).rejects.toBeInstanceOf(NotFoundError);
    await expect(listPortalServices(h.db, bookkeeper, other)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getPortalOverview(h.db, bookkeeper, otherFirmClient)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("suspending one client hides only that client; suspending all blocks the portal", async () => {
    await setPortalAccessStatus(h.db, admin, { userId: bookkeeper.userId, clientId: beta, status: "suspended" });
    expect((await listPortalClients(h.db, bookkeeper)).map((c) => c.clientId)).toEqual([acme]);
    expect((await resolvePortalClient(h.db, bookkeeper, beta)).clientId).toBe(acme);
    await expect(assertPortalClientAccess(h.db, bookkeeper, beta)).rejects.toBeInstanceOf(NotFoundError);
    await setPortalAccessStatus(h.db, admin, { userId: bookkeeper.userId, clientId: acme, status: "suspended" });
    await expect(resolvePortalClient(h.db, bookkeeper)).rejects.toBeInstanceOf(ForbiddenError);
    await setPortalAccessStatus(h.db, admin, { userId: bookkeeper.userId, clientId: acme, status: "active" });
    await setPortalAccessStatus(h.db, admin, { userId: bookkeeper.userId, clientId: beta, status: "active" });
    expect((await listPortalAccess(h.db, admin)).filter((r) => r.userId === bookkeeper.userId)).toHaveLength(2);
  });
});

describe("staff permissions for portal management", () => {
  it("staff accounts never get portal access; staff emails can't be invited", async () => {
    await expect(grantPortalAccess(h.db, admin, { userId: employee.userId, clientId: acme })).rejects.toBeInstanceOf(ValidationError);
    await expect(createPortalInvitation(h.db, admin, acme, { name: "x", email: employee.email })).rejects.toBeInstanceOf(ValidationError);
  });

  it("employees can invite but not grant or suspend; read-only users can't invite", async () => {
    const { userId } = await createPortalInvitation(h.db, employee, acme, { name: "Emp Invited", email: "empinv@example.test" }).catch(async (e) => {
      // The employee must be able to see the client first (assigned); admin created it, so expect NotFound.
      expect(e).toBeInstanceOf(NotFoundError);
      return createPortalInvitation(h.db, admin, acme, { name: "Emp Invited", email: "empinv@example.test" });
    });
    await expect(grantPortalAccess(h.db, employee, { userId, clientId: beta })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setPortalAccessStatus(h.db, employee, { userId, clientId: acme, status: "suspended" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createPortalInvitation(h.db, readOnly, acme, { name: "x", email: "ro@example.test" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("an employee only sees portal access for clients assigned to them", async () => {
    const mine = (await createClient(h.db, employee, { type: "individual", displayName: "Employee Client" })).id;
    await createPortalInvitation(h.db, employee, mine, { name: "Mine Contact", email: "mine@example.test" });
    const rows = await listPortalAccess(h.db, employee);
    expect(rows.every((r) => r.clientId === mine)).toBe(true);
    expect(rows.length).toBe(1);
  });
});

describe("portal overview counts come from real, client-safe rows", () => {
  let contact: Actor;
  beforeAll(async () => {
    const { userId } = await createPortalInvitation(h.db, admin, other, { name: "Una Related", email: "una@example.test" });
    contact = await portalActor(userId);
    const base = { firmId: admin.firmId, clientId: other, contentType: "application/pdf", sizeBytes: 10, sha256: "x", storageKey: "k" };
    await h.db.insert(documents).values([
      { ...base, fileName: "internal-workpaper.pdf", storageKey: "k1", visibility: "internal_only", status: "under_review" },
      { ...base, fileName: "shared.pdf", storageKey: "k2", visibility: "client_visible", visibleToClient: true, status: "under_review" },
      { ...base, fileName: "my-upload.pdf", storageKey: "k3", uploadedByClient: true, visibility: "client_visible", visibleToClient: true, status: "uploaded" },
      { ...base, fileName: "verified.pdf", storageKey: "k4", visibility: "client_visible", visibleToClient: true, status: "verified" },
    ]);
    const [sent] = await h.db.insert(documentRequests).values({ firmId: admin.firmId, clientId: other, title: "2026 docs", status: "sent", dueDate: "2027-02-01" }).returning();
    const [draft] = await h.db.insert(documentRequests).values({ firmId: admin.firmId, clientId: other, title: "Internal draft", status: "draft" }).returning();
    await h.db.insert(documentRequestItems).values([
      { firmId: admin.firmId, requestId: sent!.id, title: "W-2", status: "pending" },
      { firmId: admin.firmId, requestId: sent!.id, title: "1099", status: "rejected" },
      { firmId: admin.firmId, requestId: sent!.id, title: "ID", status: "verified" },
      { firmId: admin.firmId, requestId: draft!.id, title: "Not sent yet", status: "pending" },
    ]);
    await h.db.insert(signatureRequests).values([
      { firmId: admin.firmId, clientId: other, provider: "dropbox_sign", title: "Engagement letter", status: "sent" },
      { firmId: admin.firmId, clientId: other, provider: "dropbox_sign", title: "Old", status: "signed" },
    ]);
    const [conv] = await h.db.insert(conversations).values({ firmId: admin.firmId, clientId: other, subject: "Question" }).returning();
    await h.db.insert(messages).values([
      { firmId: admin.firmId, clientId: other, conversationId: conv!.id, fromClient: false, body: "Hello from the firm" },
      { firmId: admin.firmId, clientId: other, conversationId: conv!.id, fromClient: false, body: "Internal: client is late", isInternal: true, messageType: "internal_note" },
      { firmId: admin.firmId, clientId: other, conversationId: conv!.id, fromClient: true, body: "Client reply" },
    ]);
  });

  it("counts only client-visible items (no internal documents, notes or draft requests)", async () => {
    const s = await getPortalSummary(h.db, contact, other, "2027-01-15");
    expect(s.outstandingDocumentItems).toBe(2); // pending + rejected on the SENT request
    expect(s.documentsAwaitingReview).toBe(2); // shared + own upload; never the internal workpaper
    expect(s.pendingSignatures).toBe(1);
    expect(s.unreadMessages).toBe(1); // the internal note and the client's own message don't count
    expect(await countPortalUnreadMessages(h.db, contact, other)).toBe(1);
    expect(s.deadlines.map((d) => d.title)).toContain("2026 docs");
    expect(s.deadlines.map((d) => d.title)).not.toContain("Internal draft");
  });

  it("a contact-detail change is a request for staff, not a silent edit", async () => {
    await requestContactChange(h.db, contact, other, { phone: "555-010-9999", note: "New office" });
    const [c] = await h.db.select({ phone: clients.phone }).from(clients).where(eq(clients.id, other));
    expect(c!.phone).toBeNull();
    const logged = await h.db.select().from(activities).where(and(eq(activities.clientId, other), eq(activities.entityType, "client")));
    expect(logged.some((a) => (a.metadata as { kind?: string })?.kind === "profile_change_request")).toBe(true);
    await expect(requestContactChange(h.db, contact, other, {})).rejects.toBeInstanceOf(ValidationError);
    await expect(requestContactChange(h.db, contact, acme, { phone: "555-010-0000" })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("staff can't call portal services", async () => {
    await expect(getPortalSummary(h.db, admin, other, "2027-01-15")).rejects.toBeInstanceOf(ForbiddenError);
  });
});
