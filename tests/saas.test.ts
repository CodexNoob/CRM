import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DbHandle } from "@/db";
import { firms } from "@/db/schema";
import type { Actor } from "@/lib/auth/actor";
import { ForbiddenError, IntegrationNotConfiguredError, ValidationError } from "@/lib/errors";
import { login } from "@/lib/auth/login";
import { cancelFirmSubscription, cancelPendingFirmCheckout, firmAccess, getBillingOverview, startFirmCheckout } from "@/services/firm-billing";
import type { PayPalSubscriptionProvider } from "@/services/firm-billing";
import type { PayPalSubscriptionSnapshot } from "@/integrations/paypal";
import { getFirm } from "@/services/firms";
import { getOrganizationProfile, saveFirmProfile } from "@/services/settings";
import { SignupRejectedError, signUpFirm } from "@/services/signup";
import { listClients } from "@/services/clients";
import { createTestDb, createUser } from "./helpers";

const DAY = 24 * 3600_000;
const PASSWORD = "correct horse battery staple";
let n = 0;

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

beforeAll(async () => {
  h = await createTestDb();
});
afterAll(async () => {
  await h.close();
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
  it("creates a firm on a 14-day trial with its organization profile; the admin can sign in", async () => {
    const data = signup();
    const actor = await signUpFirm(h.db, data);
    expect(actor.role).toBe("admin");
    const firm = await getFirm(h.db, actor.firmId);
    expect(firm).toMatchObject({ name: "Rivera Tax & Accounting", slug: "rivera-tax-accounting", status: "trial" });
    expect(Math.round((firm.trialEndsAt!.getTime() - Date.now()) / DAY)).toBe(14);
    expect((await getOrganizationProfile(h.db, firm.id)).name).toBe("Rivera Tax & Accounting");
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

  it("requires a firm admin and starts/resumes a PayPal subscription checkout", async () => {
    const preparer = await createUser(h.db, { role: "employee", firmId: admin.firmId });
    const snapshot: PayPalSubscriptionSnapshot = {
      id: "I-subscription",
      status: "APPROVAL_PENDING",
      nextBillingAt: null,
      lastPaymentAt: null,
      lastPaymentCents: null,
      approveUrl: "https://www.paypal.com/checkoutnow?token=I-subscription",
    };
    let starts = 0;
    const provider: PayPalSubscriptionProvider = {
      isConfigured: true,
      isWebhookConfigured: true,
      currency: "USD",
      createPlan: async () => ({ planId: "P-monthly" }),
      startSubscription: async () => {
        starts += 1;
        return snapshot;
      },
      getSubscription: async () => snapshot,
      cancelSubscription: async () => {},
    };
    const urls = { returnUrl: "https://crm.example/staff?subscribed=1", cancelUrl: "https://crm.example/staff?subscribed=0" };
    await expect(startFirmCheckout(h.db, preparer, "month", urls, provider)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(startFirmCheckout(h.db, admin, "weekly", urls, provider)).rejects.toBeInstanceOf(ValidationError);
    await expect(startFirmCheckout(h.db, admin, "month", urls, { ...provider, isConfigured: false })).rejects.toBeInstanceOf(IntegrationNotConfiguredError);
    expect(await startFirmCheckout(h.db, admin, "month", urls, provider)).toBe(snapshot.approveUrl);
    expect(await startFirmCheckout(h.db, admin, "month", urls, provider)).toBe(snapshot.approveUrl);
    expect(starts).toBe(1);
  });

  it("cancels renewal but preserves access through the paid period", async () => {
    await h.db.update(firms).set({
      status: "active",
      paypalSubscriptionId: "I-cancel-me",
      nextBillingAt: new Date("2027-11-12T00:00:00Z"),
      billingInterval: "year",
    }).where(eq(firms.id, admin.firmId));
    let cancelledId: string | null = null;
    const provider: PayPalSubscriptionProvider = {
      isConfigured: true,
      isWebhookConfigured: true,
      currency: "USD",
      createPlan: async () => ({ planId: "unused" }),
      startSubscription: async () => { throw new Error("not used"); },
      getSubscription: async (id) => ({
        id,
        status: "ACTIVE",
        nextBillingAt: new Date("2027-11-12T00:00:00Z"),
        lastPaymentAt: null,
        lastPaymentCents: null,
        approveUrl: null,
      }),
      cancelSubscription: async (id) => { cancelledId = id; },
    };
    await cancelFirmSubscription(h.db, admin, provider);
    expect(cancelledId).toBe("I-cancel-me");
    const cancelled = await getFirm(h.db, admin.firmId);
    expect(cancelled.status).toBe("cancelled");
    expect(firmAccess(cancelled, new Date("2027-01-01")).locked).toBe(false);
    expect(firmAccess(cancelled, new Date("2028-01-01")).locked).toBe(true);
  });

  it("clears a declined PayPal approval checkout without cancelling an active subscription", async () => {
    const firmId = await signUpFirm(h.db, signup({ firmName: "Declined Co" })).then((actor) => actor.firmId);
    const admin = await createUser(h.db, { role: "admin", firmId });
    await h.db.update(firms).set({ paypalSubscriptionId: "I-pending", paypalCheckoutRequestId: "checkout-request" }).where(eq(firms.id, firmId));
    let cancellations = 0;
    const provider: PayPalSubscriptionProvider = {
      isConfigured: true,
      isWebhookConfigured: true,
      currency: "USD",
      createPlan: async () => ({ planId: "unused" }),
      startSubscription: async () => { throw new Error("not used"); },
      getSubscription: async () => ({
        id: "I-pending",
        status: "APPROVAL_PENDING",
        nextBillingAt: null,
        lastPaymentAt: null,
        lastPaymentCents: null,
        approveUrl: null,
      }),
      cancelSubscription: async () => { cancellations += 1; },
    };
    await cancelPendingFirmCheckout(h.db, admin, provider);
    expect(cancellations).toBe(1);
    expect((await getFirm(h.db, firmId)).paypalSubscriptionId).toBeNull();
    expect((await getFirm(h.db, firmId)).paypalCheckoutRequestId).toBeNull();
  });

  it("reports the specific missing PayPal configuration to the subscription dashboard", async () => {
    const provider: PayPalSubscriptionProvider = {
      isConfigured: false,
      isWebhookConfigured: false,
      currency: "USD",
      configurationMessage: "Production billing requires PAYPAL_ENVIRONMENT=live and PayPal live credentials.",
      createPlan: async () => ({ planId: "unused" }),
      startSubscription: async () => { throw new Error("not used"); },
      getSubscription: async () => { throw new Error("not used"); },
      cancelSubscription: async () => {},
    };
    const overview = await getBillingOverview(h.db, admin, {}, provider);
    expect(overview.paypalReady).toBe(false);
    expect(overview.paypalSetupMessage).toContain("PAYPAL_ENVIRONMENT=live");
  });

  it("an expired trial locks the firm", async () => {
    const t = await signUpFirm(h.db, signup({ firmName: "Late Co" }));
    await h.db.update(firms).set({ trialEndsAt: new Date(Date.now() - 1000) }).where(eq(firms.id, t.firmId));
    expect((await getBillingOverview(h.db, t)).access.locked).toBe(true);
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
