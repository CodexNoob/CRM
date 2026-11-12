import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { DbHandle } from "@/db";
import { auditEvents, clients } from "@/db/schema";
import type { PayPalSubscriptionSnapshot } from "@/integrations/paypal";
import type { Actor } from "@/lib/auth/actor";
import { ForbiddenError, IntegrationNotConfiguredError, NotFoundError, ValidationError } from "@/lib/errors";
import { createEngagement } from "@/services/engagements";
import {
  cancelSubscription,
  createSubscriptionPlan,
  listClientSubscriptions,
  listPortalSubscriptions,
  listSubscriptions,
  mapSubscriptionStatus,
  refreshSubscription,
  startPortalSubscription,
  type SubscriptionProvider,
} from "@/services/subscriptions";
import { createClientWithPortalUser, createTestDb, createUser } from "./helpers";

let n = 0;
const subs = new Map<string, PayPalSubscriptionSnapshot>();

function fakePayPal() {
  const state = { configured: true, calls: [] as string[] };
  const provider: SubscriptionProvider = {
    get isConfigured() {
      return state.configured;
    },
    currency: "USD",
    async createPlan(input) {
      n += 1;
      state.calls.push(`plan:${input.interval}:${input.amountCents}`);
      return { planId: `P-${n}` };
    },
    async startSubscription(input) {
      n += 1;
      const s: PayPalSubscriptionSnapshot = { id: `I-${n}`, status: "APPROVAL_PENDING", nextBillingAt: null, lastPaymentAt: null, lastPaymentCents: null, approveUrl: `https://www.sandbox.paypal.com/webapps/billing/subscriptions?ba_token=BA-${n}` };
      subs.set(s.id, s);
      state.calls.push(`start:${input.planId}:${input.subscriberEmail}:${input.returnUrl}`);
      return s;
    },
    async getSubscription(id) {
      return subs.get(id)!;
    },
    async cancelSubscription(id) {
      subs.set(id, { ...subs.get(id)!, status: "CANCELLED" });
      state.calls.push(`cancel:${id}`);
    },
  };
  const activate = (id: string) => subs.set(id, { ...subs.get(id)!, status: "ACTIVE", nextBillingAt: new Date("2026-12-12T10:00:00Z"), lastPaymentAt: new Date(), lastPaymentCents: 25000, approveUrl: null });
  return { provider, state, activate };
}

const urls = { returnUrl: "http://localhost:3000/portal/invoices?subscribed=1", cancelUrl: "http://localhost:3000/portal/invoices?subscribed=0", brandName: "Test Firm" };

let h: DbHandle;
let admin: Actor, prepA: Actor, prepB: Actor, portalA: Actor, portalB: Actor;
let clientA: string, clientB: string;
let pp: ReturnType<typeof fakePayPal>;

beforeAll(async () => {
  h = await createTestDb();
  admin = await createUser(h.db, { role: "admin" });
  prepA = await createUser(h.db, { role: "preparer" });
  prepB = await createUser(h.db, { role: "preparer" });
  const a = await createClientWithPortalUser(h.db, admin, "Client A");
  const b = await createClientWithPortalUser(h.db, admin, "Client B");
  clientA = a.client.id;
  clientB = b.client.id;
  portalA = a.portalUser;
  portalB = b.portalUser;
  await h.db.update(clients).set({ email: "a@example.test" }).where(eq(clients.id, clientA));
  await h.db.update(clients).set({ email: "b@example.test" }).where(eq(clients.id, clientB));
  await createEngagement(h.db, admin, clientA, { title: "A books", serviceType: "bookkeeping", ownerId: prepA.userId });
});

afterAll(async () => {
  await h.close();
});

beforeEach(() => {
  pp = fakePayPal();
});

describe("subscriptions", () => {
  it("maps PayPal statuses", () => {
    expect(mapSubscriptionStatus("APPROVAL_PENDING")).toBe("pending");
    expect(mapSubscriptionStatus("APPROVED")).toBe("pending");
    expect(mapSubscriptionStatus("ACTIVE")).toBe("active");
    expect(mapSubscriptionStatus("SUSPENDED")).toBe("suspended");
    expect(mapSubscriptionStatus("EXPIRED")).toBe("expired");
  });

  it("staff create a monthly or yearly plan; validation and access are enforced first", async () => {
    const sub = await createSubscriptionPlan(h.db, prepA, clientA, { name: "Monthly bookkeeping", amountCents: "250", interval: "month" }, pp.provider);
    expect(sub).toMatchObject({ status: "pending", amountCents: 25000, interval: "month", paypalSubscriptionId: null });
    expect(pp.state.calls).toEqual(["plan:month:25000"]);

    await expect(createSubscriptionPlan(h.db, admin, clientA, { name: "x", amountCents: "abc", interval: "month" }, pp.provider)).rejects.toBeInstanceOf(ValidationError);
    await expect(createSubscriptionPlan(h.db, admin, clientA, { name: "x", amountCents: "10", interval: "week" }, pp.provider)).rejects.toBeInstanceOf(ValidationError);
    await expect(createSubscriptionPlan(h.db, prepB, clientA, { name: "x", amountCents: "10", interval: "year" }, pp.provider)).rejects.toBeInstanceOf(NotFoundError);
    await expect(createSubscriptionPlan(h.db, portalA, clientA, { name: "x", amountCents: "10", interval: "year" }, pp.provider)).rejects.toBeInstanceOf(ForbiddenError);
    pp.state.configured = false;
    await expect(createSubscriptionPlan(h.db, admin, clientA, { name: "x", amountCents: "10", interval: "year" }, pp.provider)).rejects.toBeInstanceOf(IntegrationNotConfiguredError);
    expect(pp.state.calls).toEqual(["plan:month:25000"]);
  });

  it("the client's Subscribe button starts checkout only for their own pending plan", async () => {
    const sub = await createSubscriptionPlan(h.db, admin, clientA, { name: "Yearly advisory", amountCents: "1200", interval: "year" }, pp.provider);
    await expect(startPortalSubscription(h.db, portalB, sub.id, urls, pp.provider)).rejects.toBeInstanceOf(NotFoundError);
    await expect(startPortalSubscription(h.db, admin, sub.id, urls, pp.provider)).rejects.toBeInstanceOf(ForbiddenError);

    const url = await startPortalSubscription(h.db, portalA, sub.id, urls, pp.provider);
    expect(url).toContain("paypal.com");
    expect(pp.state.calls.at(-1)).toContain(`:${portalA.email}:${urls.returnUrl}`);

    // Abandoned checkout: clicking again starts a fresh one.
    const again = await startPortalSubscription(h.db, portalA, sub.id, urls, pp.provider);
    expect(again).not.toBe(url);

    // Client approves in PayPal → active on the next refresh, once.
    const [row] = (await listClientSubscriptions(h.db, admin, clientA, pp.provider)).filter((r) => r.id === sub.id);
    expect(row!.status).toBe("pending");
    const paypalId = [...subs.keys()].at(-1)!;
    pp.activate(paypalId);
    const active = await refreshSubscription(h.db, admin, sub.id, pp.provider);
    expect(active.status).toBe("active");
    expect(active.activatedAt).not.toBeNull();
    expect(active.nextBillingAt?.toISOString()).toBe("2026-12-12T10:00:00.000Z");
    await refreshSubscription(h.db, admin, sub.id, pp.provider);
    const activations = await h.db.select().from(auditEvents).where(and(eq(auditEvents.entityId, sub.id), eq(auditEvents.action, "subscription.activate")));
    expect(activations).toHaveLength(1);

    // Once active, it cannot be started again.
    await expect(startPortalSubscription(h.db, portalA, sub.id, urls, pp.provider)).rejects.toBeInstanceOf(ValidationError);
  });

  it("only admins/partners cancel; PayPal is told for live subscriptions", async () => {
    const [activeRow] = (await listSubscriptions(h.db, admin, pp.provider)).filter((r) => r.status === "active");
    await expect(cancelSubscription(h.db, prepA, activeRow!.id, pp.provider)).rejects.toBeInstanceOf(ForbiddenError);
    await cancelSubscription(h.db, admin, activeRow!.id, pp.provider);
    expect(pp.state.calls.some((c) => c.startsWith("cancel:"))).toBe(true);
    await expect(cancelSubscription(h.db, admin, activeRow!.id, pp.provider)).rejects.toBeInstanceOf(ValidationError);
  });

  it("lists respect scope", async () => {
    await createSubscriptionPlan(h.db, admin, clientB, { name: "B plan", amountCents: "99", interval: "month" }, pp.provider);
    expect((await listSubscriptions(h.db, prepA, pp.provider)).every((r) => r.clientId === clientA)).toBe(true);
    expect((await listPortalSubscriptions(h.db, portalA, pp.provider)).some((s) => s.name === "B plan")).toBe(false);
    expect((await listPortalSubscriptions(h.db, portalB, pp.provider)).map((s) => s.name)).toEqual(["B plan"]);
    await expect(listPortalSubscriptions(h.db, admin, pp.provider)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
