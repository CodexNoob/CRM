import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import type { DbHandle } from "@/db";
import { firms, paypalWebhookEvents } from "@/db/schema";
import {
  cancelSubscription,
  paypalConfig,
  verifyWebhookSignature,
  type PayPalSubscriptionSnapshot,
} from "@/integrations/paypal";
import { processPayPalWebhook, syncFirmBilling, type PayPalSubscriptionProvider } from "@/services/firm-billing";
import { createTestDb, createTestFirm } from "./helpers";
import { POST } from "@/app/api/webhooks/paypal/route";

let h: DbHandle;

beforeAll(async () => {
  h = await createTestDb();
});

afterAll(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await h.close();
});

describe("PayPal configuration and webhooks", () => {
  it("refuses sandbox credentials in production and accepts explicit live configuration", () => {
    const base = {
      NODE_ENV: "production",
      PAYPAL_CLIENT_ID: "client-id",
      PAYPAL_CLIENT_SECRET: "server-secret",
      PAYPAL_WEBHOOK_ID: "webhook-id",
    };
    expect(paypalConfig({ ...base, PAYPAL_ENVIRONMENT: "sandbox" })).toMatchObject({
      environment: "sandbox",
      isConfigured: false,
      isWebhookConfigured: true,
    });
    expect(paypalConfig({ ...base, PAYPAL_ENVIRONMENT: "live" })).toMatchObject({
      environment: "live",
      isConfigured: true,
      isWebhookConfigured: true,
    });
  });

  it("processes verified subscription changes once and ignores stale events", async () => {
    const firmId = await createTestFirm(h.db, `PayPal Firm ${crypto.randomUUID()}`);
    await h.db.update(firms).set({
      status: "trial",
      paypalSubscriptionId: "I-subscription",
      billingInterval: "month",
    }).where(eq(firms.id, firmId));

    let status: PayPalSubscriptionSnapshot["status"] = "ACTIVE";
    let lastPaymentAt: Date | null = null;
    const provider = {
      getSubscription: async (id: string): Promise<PayPalSubscriptionSnapshot> => ({
        id,
        status,
        nextBillingAt: new Date("2026-05-01T00:00:00Z"),
        lastPaymentAt,
        lastPaymentCents: null,
        approveUrl: null,
      }),
    };
    const activated = {
      id: `event-${crypto.randomUUID()}`,
      event_type: "BILLING.SUBSCRIPTION.ACTIVATED",
      create_time: "2026-04-01T00:00:00Z",
      resource: { id: "I-subscription", subscriber: { email_address: "private@example.test" } },
    };
    expect(await processPayPalWebhook(h.db, activated, new Date("2026-04-01T00:01:00Z"), provider)).toBe("processed");
    expect(await processPayPalWebhook(h.db, activated, new Date("2026-04-01T00:02:00Z"), provider)).toBe("duplicate");
    expect((await h.db.select().from(firms).where(eq(firms.id, firmId)))[0]?.status).toBe("active");

    status = "ACTIVE";
    const failed = {
      id: `event-${crypto.randomUUID()}`,
      event_type: "BILLING.SUBSCRIPTION.PAYMENT.FAILED",
      create_time: "2026-04-02T00:00:00Z",
      resource: { id: "I-subscription" },
    };
    await processPayPalWebhook(h.db, failed, new Date("2026-04-02T00:01:00Z"), provider);
    expect((await h.db.select().from(firms).where(eq(firms.id, firmId)))[0]?.status).toBe("past_due");

    const apiProvider: PayPalSubscriptionProvider = {
      isConfigured: true,
      isWebhookConfigured: true,
      currency: "USD",
      createPlan: async () => ({ planId: "unused" }),
      startSubscription: async () => { throw new Error("not used"); },
      getSubscription: provider.getSubscription,
      cancelSubscription: async () => {},
    };
    await syncFirmBilling(h.db, firmId, { force: true }, apiProvider, new Date("2026-04-03T00:00:00Z"));
    expect((await h.db.select().from(firms).where(eq(firms.id, firmId)))[0]?.status).toBe("past_due");

    lastPaymentAt = new Date("2026-04-02T12:00:00Z");
    const completed = {
      id: `event-${crypto.randomUUID()}`,
      event_type: "PAYMENT.SALE.COMPLETED",
      create_time: "2026-04-02T12:00:00Z",
      resource: { billing_agreement_id: "I-subscription" },
    };
    await processPayPalWebhook(h.db, completed, new Date("2026-04-03T00:01:00Z"), provider);
    expect((await h.db.select().from(firms).where(eq(firms.id, firmId)))[0]?.status).toBe("active");

    const staleFailure = {
      id: `event-${crypto.randomUUID()}`,
      event_type: "BILLING.SUBSCRIPTION.PAYMENT.FAILED",
      create_time: "2026-04-02T01:00:00Z",
      resource: { id: "I-subscription" },
    };
    await processPayPalWebhook(h.db, staleFailure, new Date("2026-04-03T00:02:00Z"), provider);
    expect((await h.db.select().from(firms).where(eq(firms.id, firmId)))[0]?.status).toBe("active");

    const stored = await h.db.select().from(paypalWebhookEvents);
    expect(stored).toHaveLength(4);
    expect(Object.keys(stored[0] ?? {})).not.toContain("resource");
  });

  it("uses PayPal's signature-verification API and does not process a rejected callback", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("PAYPAL_CLIENT_ID", "client-id");
    vi.stubEnv("PAYPAL_CLIENT_SECRET", "server-secret");
    vi.stubEnv("PAYPAL_ENVIRONMENT", "sandbox");
    vi.stubEnv("PAYPAL_WEBHOOK_ID", "sandbox-webhook-id");
    let verificationStatus = "SUCCESS";
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === "/v1/oauth2/token") return Response.json({ access_token: "access-token", expires_in: 3600 });
      if (url.pathname === "/v1/notifications/verify-webhook-signature") {
        const body = JSON.parse(String(init?.body)) as { webhook_id?: string };
        expect(body.webhook_id).toBe("sandbox-webhook-id");
        return Response.json({ verification_status: verificationStatus });
      }
      if (url.pathname === "/v1/billing/subscriptions/I-subscription/cancel") return new Response(null, { status: 204 });
      throw new Error(`Unexpected PayPal request: ${url.pathname}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const event = { id: "signed-event", event_type: "BILLING.SUBSCRIPTION.ACTIVATED", resource: { id: "I-subscription" } };
    const headers = {
      authAlgo: "SHA256withRSA",
      certUrl: "https://api.paypal.com/cert",
      transmissionId: "transmission-id",
      transmissionSignature: "signature",
      transmissionTime: "2026-04-01T00:00:00Z",
    };
    expect(await verifyWebhookSignature(headers, event)).toBe(true);
    await expect(cancelSubscription("I-subscription", "Test cancellation")).resolves.toBeUndefined();

    verificationStatus = "FAILURE";
    const request = new NextRequest("https://crm.example/api/webhooks/paypal", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "paypal-auth-algo": headers.authAlgo,
        "paypal-cert-url": headers.certUrl,
        "paypal-transmission-id": headers.transmissionId,
        "paypal-transmission-sig": headers.transmissionSignature,
        "paypal-transmission-time": headers.transmissionTime,
      },
      body: JSON.stringify(event),
    });
    const response = await POST(request);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "Webhook signature verification failed." });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
