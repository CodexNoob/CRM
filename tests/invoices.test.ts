import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { DbHandle } from "@/db";
import { auditEvents, clients, invoices } from "@/db/schema";
import type { PayPalInvoiceSnapshot, PayPalInvoiceStatus } from "@/integrations/paypal";
import { PayPalError } from "@/integrations/paypal";
import type { Actor } from "@/lib/auth/actor";
import { AppError, ForbiddenError, IntegrationNotConfiguredError, NotFoundError, ValidationError } from "@/lib/errors";
import { formatMoney } from "@/lib/labels";
import { parseInvoiceInput } from "@/lib/validation";
import { createEngagement } from "@/services/engagements";
import {
  cancelInvoice,
  countOpenPortalInvoices,
  createInvoice,
  invoiceTotals,
  listClientInvoices,
  listInvoices,
  listPortalInvoices,
  mapPayPalStatus,
  refreshInvoice,
  sendInvoice,
  type InvoiceProvider,
} from "@/services/invoices";
import { createClientWithPortalUser, createTestDb, createUser } from "./helpers";

/** In-memory stand-in for PayPal. Ids are unique across tests, like real PayPal ids. */
let n = 0;
const store = new Map<string, PayPalInvoiceSnapshot>();
function fakePayPal() {
  const state = { failSend: false, configured: true, calls: [] as string[] };
  const provider: InvoiceProvider = {
    get isConfigured() {
      return state.configured;
    },
    currency: "USD",
    async createDraftInvoice(input) {
      n += 1;
      const total = input.items.reduce((s, i) => s + i.quantity * i.unitCents, 0);
      const snap: PayPalInvoiceSnapshot = { id: `INV2-${n}`, invoiceNumber: `000${n}`, status: "DRAFT", totalCents: total, dueCents: total, paidCents: 0, currency: "USD", payUrl: null };
      store.set(snap.id, snap);
      state.calls.push(`create:${input.recipientEmail}`);
      return snap;
    },
    async sendInvoice(id) {
      if (state.failSend) throw new PayPalError("Recipient email is invalid.", 422, "INVALID_EMAIL");
      const s = { ...store.get(id)!, status: "UNPAID" as const, payUrl: `https://www.sandbox.paypal.com/invoice/p/#${id}` };
      store.set(id, s);
      state.calls.push(`send:${id}`);
      return s;
    },
    async getInvoice(id) {
      return store.get(id)!;
    },
    async cancelInvoice(id) {
      store.set(id, { ...store.get(id)!, status: "CANCELLED" });
      state.calls.push(`cancel:${id}`);
    },
    async deleteDraftInvoice(id) {
      store.delete(id);
      state.calls.push(`delete:${id}`);
    },
  };
  /** Simulates the client paying in PayPal. */
  const pay = (id: string, status: PayPalInvoiceStatus = "PAID", paidCents?: number) => {
    const s = store.get(id)!;
    store.set(id, { ...s, status, paidCents: paidCents ?? s.totalCents });
  };
  return { provider, state, pay, store };
}

const form = (over: Record<string, string> = {}) => ({
  title: "2026 Individual tax return",
  dueDate: "2027-04-15",
  item0Name: "Form 1040 preparation",
  item0Qty: "1",
  item0Amount: "350",
  item1Name: "Schedule C",
  item1Qty: "2",
  item1Amount: "75.50",
  ...over,
});

let h: DbHandle;
let admin: Actor, prepA: Actor, prepB: Actor, portalA: Actor, portalB: Actor;
let clientA: string, clientB: string, noEmailClient: string;
let pp: ReturnType<typeof fakePayPal>;

beforeAll(async () => {
  h = await createTestDb();
  admin = await createUser(h.db, { role: "admin", name: "Ada Admin" });
  prepA = await createUser(h.db, { role: "preparer", name: "Pat A" });
  prepB = await createUser(h.db, { role: "preparer", name: "Pat B" });
  const a = await createClientWithPortalUser(h.db, admin, "Jordan Sample");
  const b = await createClientWithPortalUser(h.db, admin, "Client B");
  const c = await createClientWithPortalUser(h.db, admin, "No Email");
  clientA = a.client.id;
  clientB = b.client.id;
  noEmailClient = c.client.id;
  portalA = a.portalUser;
  portalB = b.portalUser;
  await h.db.update(clients).set({ email: "jordan@example.test" }).where(eq(clients.id, clientA));
  await h.db.update(clients).set({ email: "b@example.test" }).where(eq(clients.id, clientB));
  // prepA works on client A only.
  await createEngagement(h.db, admin, clientA, { title: "A 1040", serviceType: "individual_tax", ownerId: prepA.userId });
});

afterAll(async () => {
  await h.close();
});

beforeEach(() => {
  pp = fakePayPal();
});

describe("invoice input", () => {
  it("parses dollars to cents and totals the lines", () => {
    const r = parseInvoiceInput(form({ item1Amount: "$1,075.5" }));
    expect(r.items).toEqual([
      { name: "Form 1040 preparation", quantity: 1, unitCents: 35000 },
      { name: "Schedule C", quantity: 2, unitCents: 107550 },
    ]);
    expect(r.totalCents).toBe(35000 + 2 * 107550);
  });

  it("ignores blank rows, requires at least one line, and keys errors by field", () => {
    expect(() => parseInvoiceInput({ title: "x" })).toThrow(ValidationError);
    try {
      parseInvoiceInput({ title: "", item0Name: "Prep", item0Amount: "-5", item3Name: "", item3Amount: "" });
    } catch (e) {
      const fe = (e as ValidationError).fieldErrors;
      expect(fe.title).toBeDefined();
      expect(fe.item0Amount).toBeDefined();
      expect(fe.item3Name).toBeUndefined();
    }
    expect(() => parseInvoiceInput(form({ item0Amount: "12.345" }))).toThrow(ValidationError);
    expect(() => parseInvoiceInput(form({ item0Amount: "0" }))).toThrow(ValidationError);
    expect(() => parseInvoiceInput(form({ item0Amount: "100000", item0Qty: "2" }))).toThrow(ValidationError);
  });

  it("formats money", () => {
    expect(formatMoney(125050)).toBe("$1,250.50");
  });

  it("maps PayPal statuses", () => {
    expect(mapPayPalStatus("UNPAID")).toBe("sent");
    expect(mapPayPalStatus("PAYMENT_PENDING")).toBe("sent");
    expect(mapPayPalStatus("PARTIALLY_PAID")).toBe("partially_paid");
    expect(mapPayPalStatus("MARKED_AS_PAID")).toBe("paid");
    expect(mapPayPalStatus("CANCELLED")).toBe("cancelled");
    expect(mapPayPalStatus("REFUNDED")).toBe("refunded");
  });
});

describe("creating and sending", () => {
  it("creates in PayPal, sends to the client's email, stores the linked copy and audits", async () => {
    const inv = await createInvoice(h.db, prepA, clientA, form(), pp.provider);
    expect(inv.status).toBe("sent");
    expect(inv.totalCents).toBe(35000 + 15100);
    expect(inv.recipientEmail).toBe("jordan@example.test");
    expect(inv.payUrl).toContain("paypal.com");
    expect(inv.sentAt).not.toBeNull();
    expect(pp.state.calls).toEqual(["create:jordan@example.test", `send:${inv.paypalInvoiceId}`]);
    const audits = await h.db.select().from(auditEvents).where(eq(auditEvents.entityId, inv.id));
    expect(audits.map((a) => a.action).sort()).toEqual(["invoice.create", "invoice.send"]);
    expect(audits.every((a) => (a.metadata as { clientId?: string }).clientId === clientA)).toBe(true);
  });

  it("enforces client access: preparers only bill their assigned clients; clients cannot bill", async () => {
    await expect(createInvoice(h.db, prepB, clientA, form(), pp.provider)).rejects.toBeInstanceOf(NotFoundError);
    await expect(createInvoice(h.db, prepA, clientB, form(), pp.provider)).rejects.toBeInstanceOf(NotFoundError);
    await expect(createInvoice(h.db, portalA, clientA, form(), pp.provider)).rejects.toBeInstanceOf(ForbiddenError);
    expect(pp.state.calls).toEqual([]);
  });

  it("requires a client email and a configured PayPal, before calling PayPal", async () => {
    await expect(createInvoice(h.db, admin, noEmailClient, form(), pp.provider)).rejects.toBeInstanceOf(ValidationError);
    pp.state.configured = false;
    await expect(createInvoice(h.db, admin, clientB, form(), pp.provider)).rejects.toBeInstanceOf(IntegrationNotConfiguredError);
    expect(pp.state.calls).toEqual([]);
  });

  it("rejects an engagement that belongs to another client", async () => {
    const engB = await createEngagement(h.db, admin, clientB, { title: "B 1120", serviceType: "business_tax", ownerId: admin.userId });
    await expect(createInvoice(h.db, admin, clientA, form({ engagementId: engB.id }), pp.provider)).rejects.toBeInstanceOf(ValidationError);
  });

  it("keeps a draft when PayPal's send fails, and can re-send it", async () => {
    pp.state.failSend = true;
    await expect(createInvoice(h.db, admin, clientB, form({ title: "Draft test" }), pp.provider)).rejects.toBeInstanceOf(AppError);
    const [draft] = await h.db.select().from(invoices).where(and(eq(invoices.clientId, clientB), eq(invoices.title, "Draft test")));
    expect(draft!.status).toBe("draft");
    pp.state.failSend = false;
    const sent = await sendInvoice(h.db, admin, draft!.id, pp.provider);
    expect(sent.status).toBe("sent");
    await expect(sendInvoice(h.db, admin, draft!.id, pp.provider)).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("status sync, cancel and lists", () => {
  it("picks up payment from PayPal once, recording invoice.paid", async () => {
    const inv = await createInvoice(h.db, admin, clientA, form({ title: "Pay me" }), pp.provider);
    pp.pay(inv.paypalInvoiceId!, "PARTIALLY_PAID", 10000);
    let r = await refreshInvoice(h.db, admin, inv.id, pp.provider);
    expect(r.status).toBe("partially_paid");
    expect(r.paidCents).toBe(10000);
    pp.pay(inv.paypalInvoiceId!);
    r = await refreshInvoice(h.db, admin, inv.id, pp.provider);
    expect(r.status).toBe("paid");
    expect(r.paidAt).not.toBeNull();
    await refreshInvoice(h.db, admin, inv.id, pp.provider);
    const paid = await h.db.select().from(auditEvents).where(and(eq(auditEvents.entityId, inv.id), eq(auditEvents.action, "invoice.paid")));
    expect(paid).toHaveLength(1);
  });

  it("list views refresh stale open invoices automatically", async () => {
    const inv = await createInvoice(h.db, admin, clientA, form({ title: "Stale" }), pp.provider);
    pp.pay(inv.paypalInvoiceId!);
    const later = new Date(Date.now() + 10 * 60_000);
    const rows = await listClientInvoices(h.db, admin, clientA, pp.provider, later);
    expect(rows.find((r) => r.id === inv.id)!.status).toBe("paid");
  });

  it("only admins/partners cancel, and only unpaid invoices", async () => {
    const inv = await createInvoice(h.db, prepA, clientA, form({ title: "Cancel me" }), pp.provider);
    await expect(cancelInvoice(h.db, prepA, inv.id, pp.provider)).rejects.toBeInstanceOf(ForbiddenError);
    await cancelInvoice(h.db, admin, inv.id, pp.provider);
    expect(pp.state.calls).toContain(`cancel:${inv.paypalInvoiceId}`);
    const [row] = await h.db.select().from(invoices).where(eq(invoices.id, inv.id));
    expect(row!.status).toBe("cancelled");
    await expect(cancelInvoice(h.db, admin, inv.id, pp.provider)).rejects.toBeInstanceOf(ValidationError);
  });

  it("staff lists respect assignments; ids from elsewhere are not found", async () => {
    const bInv = await createInvoice(h.db, admin, clientB, form({ title: "B only" }), pp.provider);
    const prepRows = await listInvoices(h.db, prepA, {}, pp.provider);
    expect(prepRows.every((r) => r.clientId === clientA)).toBe(true);
    const adminRows = await listInvoices(h.db, admin, { status: "open" }, pp.provider);
    expect(adminRows.some((r) => r.id === bInv.id)).toBe(true);
    await expect(refreshInvoice(h.db, prepA, bInv.id, pp.provider)).rejects.toBeInstanceOf(NotFoundError);
    await expect(refreshInvoice(h.db, admin, "not-a-uuid", pp.provider)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("totals count only open balances and recent payments", async () => {
    const t = await invoiceTotals(h.db, admin, "2099-01-01");
    expect(t.openCount).toBeGreaterThan(0);
    expect(t.overdueCount).toBe(t.openCount); // every open invoice is due before 2099
    expect(t.paidLast30Cents).toBeGreaterThan(0);
  });
});

describe("client portal", () => {
  it("shows a client only their own non-draft invoices, with pay links only on open ones", async () => {
    pp.state.failSend = true;
    await createInvoice(h.db, admin, clientA, form({ title: "Hidden draft" }), pp.provider).catch(() => undefined);
    pp.state.failSend = false;
    const mine = await listPortalInvoices(h.db, portalA, pp.provider);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.some((i) => i.title === "Hidden draft")).toBe(false);
    expect(mine.some((i) => i.title === "B only")).toBe(false);
    for (const i of mine) {
      if (i.status === "sent" || i.status === "partially_paid") expect(i.payUrl).toBeTruthy();
      else expect(i.payUrl).toBeNull();
    }
    expect(await countOpenPortalInvoices(h.db, portalA)).toBe(mine.filter((i) => i.payUrl).length);
    const theirs = await listPortalInvoices(h.db, portalB, pp.provider);
    expect(theirs.every((i) => i.title !== "Pay me")).toBe(true);
    await expect(listPortalInvoices(h.db, admin, pp.provider)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
