import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { DbHandle } from "@/db";
import { clientNotifications, conversations, documents, messageAttachments, messages } from "@/db/schema";
import type { Actor } from "@/lib/auth/actor";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import {
  assignConversation,
  countInboxFolders,
  countUnreadForClient,
  countUnreadForStaff,
  createConversation,
  createPortalConversation,
  getConversation,
  getPortalConversation,
  getThread,
  listAssignmentHistory,
  listInbox,
  listPortalConversations,
  replyAsClient,
  replyAsStaff,
  sendMessage,
  setConversationStatus,
} from "@/services/messages";
import { createClientWithPortalUser, createTestDb, createUser } from "./helpers";

/** Client collaboration — Messages. Real services against an in-memory Postgres. */

const PDF = Buffer.from("%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");

let h: DbHandle;
let admin: Actor, manager: Actor, employee: Actor, readOnly: Actor, portalA: Actor, portalB: Actor;
let clientA: string, clientB: string;

beforeAll(async () => {
  h = await createTestDb();
  admin = await createUser(h.db, { role: "admin", name: "Ada Admin" });
  manager = await createUser(h.db, { role: "manager", name: "Max Manager" });
  employee = await createUser(h.db, { role: "employee", name: "Eve Employee" });
  readOnly = await createUser(h.db, { role: "read_only", name: "Rory Readonly" });
  const a = await createClientWithPortalUser(h.db, admin, "Alpha Client");
  const b = await createClientWithPortalUser(h.db, admin, "Beta Client");
  clientA = a.client.id;
  clientB = b.client.id;
  portalA = a.portalUser;
  portalB = b.portalUser;
});
afterAll(async () => {
  await h.close();
});

describe("conversations", () => {
  let convId: string;

  it("staff creates a conversation; the client sees it with an unread count and a portal notification", async () => {
    const c = await createConversation(h.db, manager, clientA, { subject: "2026 return questions", category: "tax_return", body: "Could you confirm your dependents?" });
    convId = c.id;
    expect(c).toMatchObject({ status: "waiting_for_client", category: "tax_return", conversationNumber: 1 });

    const list = await listPortalConversations(h.db, portalA, clientA);
    expect(list.map((x) => x.subject)).toEqual(["2026 return questions"]);
    expect(list[0]!.unread).toBe(1);
    expect(await countUnreadForClient(h.db, portalA, clientA)).toBe(1);
    const notes = await h.db.select().from(clientNotifications).where(eq(clientNotifications.userId, portalA.userId));
    expect(notes.map((n) => n.type)).toEqual(["message"]); // in-app only, never an email
  });

  it("client reply flips the status to waiting for staff and shows up as unread for staff", async () => {
    await getPortalConversation(h.db, portalA, clientA, convId); // reading marks it read for the client
    expect(await countUnreadForClient(h.db, portalA, clientA)).toBe(0);
    await replyAsClient(h.db, portalA, clientA, convId, "Two dependents, same as last year.");
    const [c] = await h.db.select().from(conversations).where(eq(conversations.id, convId));
    expect(c!.status).toBe("waiting_for_staff");
    expect(await countUnreadForStaff(h.db, manager)).toBe(1);
    const inbox = await listInbox(h.db, manager, { folder: "waiting_for_staff" });
    expect(inbox[0]).toMatchObject({ id: convId, unread: 1, lastFromClient: true, lastBody: "Two dependents, same as last year." });
    await getConversation(h.db, manager, convId);
    expect(await countUnreadForStaff(h.db, manager)).toBe(0);
    // Read positions are per person: the admin still has it unread.
    expect(await countUnreadForStaff(h.db, admin)).toBe(1);
  });

  it("internal notes never reach the client — through any portal function", async () => {
    await replyAsStaff(h.db, manager, convId, { body: "SECRET: client may owe AMT", internal: true }, [{ fileName: "workpaper.pdf", data: PDF }]);
    const staffView = await getConversation(h.db, manager, convId);
    expect(staffView.messages.some((m) => m.isInternal && m.body.includes("SECRET"))).toBe(true);

    const portalView = await getPortalConversation(h.db, portalA, clientA, convId);
    expect(JSON.stringify(portalView)).not.toContain("SECRET");
    expect(JSON.stringify(portalView)).not.toContain("workpaper.pdf");
    expect(JSON.stringify(await listPortalConversations(h.db, portalA, clientA))).not.toContain("SECRET");
    expect(JSON.stringify(await getThread(h.db, portalA))).not.toContain("SECRET");
    expect(await countUnreadForClient(h.db, portalA, clientA)).toBe(0);
    // The staff inbox preview never shows internal notes either.
    expect((await listInbox(h.db, manager, { folder: "all" }))[0]!.lastBody).not.toContain("SECRET");
    // The internal note's attachment is an internal-only document.
    const [att] = await h.db
      .select({ visibility: documents.visibility, visibleToClient: documents.visibleToClient })
      .from(messageAttachments)
      .innerJoin(documents, eq(documents.id, messageAttachments.documentId))
      .innerJoin(messages, eq(messages.id, messageAttachments.messageId))
      .where(eq(messages.isInternal, true));
    expect(att).toEqual({ visibility: "internal_only", visibleToClient: false });
    // Internal notes don't change the status.
    const [c] = await h.db.select().from(conversations).where(eq(conversations.id, convId));
    expect(c!.status).toBe("waiting_for_staff");
  });

  it("staff attachments on client-visible messages are shared with the client and stored once", async () => {
    await replyAsStaff(h.db, manager, convId, { body: "Here is your organizer." }, [{ fileName: "organizer.pdf", data: PDF }]);
    const view = await getPortalConversation(h.db, portalA, clientA, convId);
    const last = view.messages.at(-1)!;
    expect(last.attachments.map((a) => a.fileName)).toEqual(["organizer.pdf"]);
    const [doc] = await h.db.select().from(documents).where(eq(documents.id, last.attachments[0]!.id));
    expect(doc).toMatchObject({ visibility: "shared_with_client", clientId: clientA });
    const [c] = await h.db.select().from(conversations).where(eq(conversations.id, convId));
    expect(c!.status).toBe("waiting_for_client");
  });

  it("another client can't read or reply to the conversation, whatever ids they send", async () => {
    await expect(getPortalConversation(h.db, portalB, clientB, convId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getPortalConversation(h.db, portalB, clientA, convId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(replyAsClient(h.db, portalB, clientA, convId, "hi")).rejects.toBeInstanceOf(NotFoundError);
    await expect(replyAsClient(h.db, portalB, clientB, convId, "hi")).rejects.toBeInstanceOf(NotFoundError);
    await expect(listPortalConversations(h.db, portalB, clientA)).rejects.toBeInstanceOf(NotFoundError);
    expect(await listPortalConversations(h.db, portalB, clientB)).toEqual([]);
    // Portal users can't call staff functions.
    await expect(getConversation(h.db, portalA, convId)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listInbox(h.db, portalA)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("employees without access can't see it until assigned; assignment history is kept", async () => {
    await expect(getConversation(h.db, employee, convId)).rejects.toBeInstanceOf(NotFoundError);
    expect((await listInbox(h.db, employee, { folder: "all" })).some((c) => c.id === convId)).toBe(false);
    await expect(assignConversation(h.db, employee, convId, employee.userId)).rejects.toBeInstanceOf(ForbiddenError);

    await assignConversation(h.db, manager, convId, employee.userId);
    expect((await getConversation(h.db, employee, convId)).assigneeName).toBe("Eve Employee");
    expect((await listInbox(h.db, employee, { folder: "mine" })).map((c) => c.id)).toEqual([convId]);
    await assignConversation(h.db, admin, convId, manager.userId);
    const history = await listAssignmentHistory(h.db, manager, convId);
    expect(history.map((x) => x.toName)).toEqual(["Eve Employee", "Max Manager"]);
    expect((await countInboxFolders(h.db, manager)).mine).toBe(1);
  });

  it("read-only users can view but not message; closed conversations can't take client replies", async () => {
    await getConversation(h.db, readOnly, convId);
    await expect(replyAsStaff(h.db, readOnly, convId, { body: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createConversation(h.db, readOnly, clientA, { subject: "x", body: "y" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setConversationStatus(h.db, readOnly, convId, "closed")).rejects.toBeInstanceOf(ForbiddenError);

    await setConversationStatus(h.db, manager, convId, "closed");
    await expect(replyAsClient(h.db, portalA, clientA, convId, "one more thing")).rejects.toBeInstanceOf(ValidationError);
    // Staff may reopen by replying.
    await replyAsStaff(h.db, manager, convId, { body: "Reopening — one more question." });
    const [c] = await h.db.select().from(conversations).where(eq(conversations.id, convId));
    expect(c!.status).toBe("waiting_for_client");
  });

  it("a client can start a conversation; it lands with staff", async () => {
    const c = await createPortalConversation(h.db, portalB, clientB, { subject: "Billing question", category: "billing", body: "Is my invoice paid?" });
    expect(c).toMatchObject({ status: "waiting_for_staff", clientId: clientB });
    // A portal user can't start one for a client they don't belong to.
    await expect(createPortalConversation(h.db, portalB, clientA, { subject: "x", body: "y" })).rejects.toBeInstanceOf(NotFoundError);
    expect((await listInbox(h.db, admin, { folder: "unassigned" })).some((x) => x.id === c.id)).toBe(true);
  });

  it("legacy sendMessage posts into the client's General conversation", async () => {
    await sendMessage(h.db, portalA, "Uploaded my W-2.");
    await sendMessage(h.db, manager, "Thanks!", clientA);
    const general = await h.db.select().from(conversations).where(and(eq(conversations.clientId, clientA), eq(conversations.subject, "General")));
    expect(general).toHaveLength(1);
    const msgs = await h.db.select().from(messages).where(eq(messages.conversationId, general[0]!.id));
    expect(msgs.map((m) => m.body)).toEqual(["Uploaded my W-2.", "Thanks!"]);
    await expect(sendMessage(h.db, readOnly, "x", clientA)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
