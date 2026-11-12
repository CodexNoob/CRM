import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DbHandle } from "@/db";
import { firms, platformPlans } from "@/db/schema";
import type { PayPalSubscriptionSnapshot } from "@/integrations/paypal";
import type { Actor } from "@/lib/auth/actor";
import { ForbiddenError, IntegrationNotConfiguredError, ValidationError } from "@/lib/errors";
import { login } from "@/lib/auth/login";
import { cancelFirmSubscription, firmAccess, getBillingOverview, startFirmCheckout, syncFirmBilling } from "@/services/firm-billing";
import { getFirm } from "@/services/firms";
import { getPublicProfile, saveFirmProfile } from "@/services/settings";
import { SignupRejectedError, signUpFirm } from "@/services/signup";
import type { SubscriptionProvider } from "@/services/subscriptions";
import { listClients } from "@/services/clients";
import { createTestDb, createUser } from "./helpers";

const DAY = 24 * 3600_000;
const PASSWORD = "correct horse battery staple";
const urls = { returnUrl: "http://localhost:3000/staff/billing?subscribed=1", cancelUrl: "http://localhost:3000/staff/billing?subscribed=0" };

let n = 0;
const subs = new Map<string, PayPalSubscriptionSnapshot>();
function fakePayPal() {
  const state = { configured: true, plans: [] as string[] };
  const p: SubscriptionProvider = {
    get isConfigured() {
      return state.configured;
    },
    currency: "USD",
    async createPlan(i) {
      state.plans.push(`${i.interval}:${i.amountCents}`);
      return { planId: `P-${++n}` };
    },
    async startSubscription() {
      const s: PayPalSubscriptionSnapshot = { id: `I-${++n}`, status: "APPROVAL_PENDING", nextBillingAt: null, lastPaymentAt: null, lastPaymentCents: null, approveUrl: `https://www.sandbox.paypal.com/approve/${n}` };
      subs.set(s.id, s);
      return s;
    },
    async getSubscription(id) {
      return subs.get(id)!;
    },
    async cancelSubscription(id) {
      subs.set(id, { ...subs.get(id)!, status: "CANCELLED" });
    },
  };
  return { p, state };
}

const signup = (over: Record<string, unknown> = {}) => ({
  firmName: "Rivera Tax & Accounting",
  name: "Sam Rivera",
  email: `sam${++n}@rivera.test`,
  password: PASSWORD,
  confirmPassword: PASSWORD,
  terms: "on",
  startedAt: String(Date.now() - 10_000),
  ...over,
});

let h: DbHandle;
let pp: ReturnType<typeof fakePayPal>;

beforeAll(async () => {
  h = await createTestDb();
});
afterAll(async () => {
  await h.close();
});
beforeEach(() => {
  pp = fakePayPal();
});

describe("access rules", () => {
  const now = new Date("2026-11-12T12:00:00Z");
  it("trial is open until it ends, then locked; active and past_due stay open", () => {
    expect(firmAccess({ status: "trial", trialEndsAt: new Date(now.getTime() + 3.2 * DAY), nextBillingAt: null }, now)).toMatchObject({ state: "trial", locked: false, trialDaysLeft: 4 });
    expect(firmAccess({ status: "trial", trialEndsAt: new Date(now.getTime() - 1), nextBillingAt: null }, now)).toMatchObject({ state: "locked", locked: true });
    expect(firmAccess({ status: "active", trialEndsAt: null, nextBillingAt: null }, now).locked).toBe(false);
    expect(firmAccess({ status: "past_due", trialEndsAt: null, nextBillingAt: null }, now)).toMatchObject({ state: "past_due", locked: false });
  });
  it("a cancelled subscription keeps access until the paid period ends", () => {
    expect(firmAccess({ status: "cancelled", trialEndsAt: null, nextBillingAt: new Date(now.getTime() + DAY) }, now).locked).toBe(false);
    expect(firmAccess({ status: "cancelled", trialEndsAt: null, nextBillingAt: new Date(now.getTime() - DAY) }, now).locked).toBe(true);
  });
});

describe("sign-up", () => {
  it("creates a firm on a 14-day trial with its admin and public profile; the admin can sign in", async () => {
    const data = signup();
    const actor = await signUpFirm(h.db, data);
    expect(actor.role).toBe("admin");
    const firm = await getFirm(h.db, actor.firmId);
    expect(firm).toMatchObject({ name: "Rivera Tax & Accounting", slug: "rivera-tax-accounting", status: "trial" });
    expect(Math.round((firm.trialEndsAt!.getTime() - Date.now()) / DAY)).toBe(14);
    expect((await getPublicProfile(h.db, firm.id)).name).toBe("Rivera Tax & Accounting");
    const session = await login(h.db, { email: data.email as string, password: PASSWORD });
    expect(session.actor.firmId).toBe(firm.id);
    expect(await listClients(h.db, actor)).toEqual([]); // a brand-new, empty workspace
  });

  it("gives a second firm with the same name its own address", async () => {
    const a = await signUpFirm(h.db, signup({ firmName: "Same Name CPA" }));
    const b = await signUpFirm(h.db, signup({ firmName: "Same Name CPA" }));
    expect((await getFirm(h.db, a.firmId)).slug).toBe("same-name-cpa");
    expect((await getFirm(h.db, b.firmId)).slug).toBe("same-name-cpa-2");
  });

  it("rejects bots, duplicates and bad input", async () => {
    await expect(signUpFirm(h.db, signup({ website: "http://spam" }))).rejects.toBeInstanceOf(SignupRejectedError);
    await expect(signUpFirm(h.db, signup({ startedAt: String(Date.now()) }))).rejects.toBeInstanceOf(SignupRejectedError);
    const data = signup();
    await signUpFirm(h.db, data);
    await expect(signUpFirm(h.db, signup({ email: (data.email as string).toUpperCase() }))).rejects.toBeInstanceOf(ValidationError);
    await expect(signUpFirm(h.db, signup({ terms: undefined }))).rejects.toBeInstanceOf(ValidationError);
    await expect(signUpFirm(h.db, signup({ confirmPassword: "different password!!" }))).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("subscribing to the software", () => {
  let admin: Actor;
  beforeAll(async () => {
    admin = await signUpFirm(h.db, signup({ firmName: "Pay Co" }));
  });

  it("only a firm admin can start checkout; PayPal must be connected", async () => {
    const preparer = await createUser(h.db, { role: "preparer", firmId: admin.firmId });
    await expect(startFirmCheckout(h.db, preparer, "month", urls, pp.p)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(startFirmCheckout(h.db, admin, "weekly", urls, pp.p)).rejects.toBeInstanceOf(ValidationError);
    pp.state.configured = false;
    await expect(startFirmCheckout(h.db, admin, "month", urls, pp.p)).rejects.toBeInstanceOf(IntegrationNotConfiguredError);
  });

  it("checkout → approval → active; plans are created once per interval at the listed price", async () => {
    const url = await startFirmCheckout(h.db, admin, "year", urls, pp.p);
    expect(url).toContain("paypal.com");
    expect(pp.state.plans).toEqual(["year:99000"]);
    await startFirmCheckout(h.db, admin, "year", urls, pp.p); // abandoned once, retried
    expect(pp.state.plans).toEqual(["year:99000"]); // plan reused
    const [plan] = await h.db.select().from(platformPlans).where(eq(platformPlans.interval, "year"));
    expect(plan!.amountCents).toBe(99000);

    let firm = await getFirm(h.db, admin.firmId);
    expect(firm.status).toBe("trial");
    subs.set(firm.paypalSubscriptionId!, { ...subs.get(firm.paypalSubscriptionId!)!, status: "ACTIVE", nextBillingAt: new Date("2027-11-12T00:00:00Z") });
    firm = await syncFirmBilling(h.db, admin.firmId, { force: true }, pp.p);
    expect(firm).toMatchObject({ status: "active", billingInterval: "year" });
    expect(firm.nextBillingAt?.toISOString()).toBe("2027-11-12T00:00:00.000Z");
    expect((await getBillingOverview(h.db, admin, {}, pp.p)).access.state).toBe("active");
    await expect(startFirmCheckout(h.db, admin, "month", urls, pp.p)).rejects.toBeInstanceOf(ValidationError);
  });

  it("a failed payment marks past_due (still open); cancelling keeps access until the period ends", async () => {
    const firm = await getFirm(h.db, admin.firmId);
    subs.set(firm.paypalSubscriptionId!, { ...subs.get(firm.paypalSubscriptionId!)!, status: "SUSPENDED" });
    expect((await syncFirmBilling(h.db, admin.firmId, { force: true }, pp.p)).status).toBe("past_due");
    subs.set(firm.paypalSubscriptionId!, { ...subs.get(firm.paypalSubscriptionId!)!, status: "ACTIVE" });
    await syncFirmBilling(h.db, admin.firmId, { force: true }, pp.p);

    await cancelFirmSubscription(h.db, admin, pp.p);
    const cancelled = await getFirm(h.db, admin.firmId);
    expect(cancelled.status).toBe("cancelled");
    expect(firmAccess(cancelled, new Date("2027-01-01")).locked).toBe(false);
    expect(firmAccess(cancelled, new Date("2028-01-01")).locked).toBe(true);
  });

  it("an expired trial locks the firm", async () => {
    const t = await signUpFirm(h.db, signup({ firmName: "Late Co" }));
    await h.db.update(firms).set({ trialEndsAt: new Date(Date.now() - 1000) }).where(eq(firms.id, t.firmId));
    expect((await getBillingOverview(h.db, t, {}, pp.p)).access.locked).toBe(true);
  });
});

describe("firm name", () => {
  it("saving the public name renames the firm account", async () => {
    const admin = await signUpFirm(h.db, signup({ firmName: "Old Name LLC" }));
    await saveFirmProfile(h.db, admin, { name: "New Name LLC" });
    const firm = await getFirm(h.db, admin.firmId);
    expect(firm.name).toBe("New Name LLC");
    expect(firm.slug).toBe("old-name-llc"); // the public address doesn't change
  });
});
