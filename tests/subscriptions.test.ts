import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import type { DbHandle } from "@/db";
import { clients, invoices, qboConnections, qboCustomerLinks, subscriptions } from "@/db/schema";
import { encryptToken, type QboConfig } from "@/integrations/qbo";
import type { Actor } from "@/lib/auth/actor";
import { ForbiddenError, IntegrationNotConfiguredError, NotFoundError } from "@/lib/errors";
import { issueScheduledInvoice } from "@/services/invoices";
import { cancelSubscription, createSubscriptionPlan, listDueSubscriptions, listPortalSubscriptions } from "@/services/subscriptions";
import { createTestDb, createTestFirm, createUser } from "./helpers";

const KEY = Buffer.alloc(32, 9).toString("base64");
const config: QboConfig = {
  clientId: "test-client",
  clientSecret: "test-secret",
  appUrl: "http://localhost:3000",
  redirectUri: "http://localhost:3000/api/integrations/qbo/callback",
  tokenEncryptionKey: KEY,
  environment: "sandbox",
};

let h: DbHandle;
let admin: Actor;
let portal: Actor;
let clientId: string;
let firmId: string;
let externalCreateCount: number;
let fetchMock: ReturnType<typeof vi.fn>;

async function setupFirm() {
  firmId = await createTestFirm(h.db, `Schedule Firm ${crypto.randomUUID()}`);
  admin = await createUser(h.db, { role: "admin", firmId });
  const [client] = await h.db.insert(clients).values({
    firmId,
    type: "individual",
    displayName: "Client with schedule",
    email: "client@example.test",
    createdById: admin.userId,
  }).returning();
  clientId = client!.id;
  portal = await createUser(h.db, { role: "client", clientId, firmId });
  const [connection] = await h.db.insert(qboConnections).values({
    scope: "firm",
    firmId,
    realmId: "sandbox-company",
    companyName: "Test Sandbox",
    accessTokenEncrypted: encryptToken("access-token", config),
    refreshTokenEncrypted: encryptToken("refresh-token", config),
    accessExpiresAt: new Date(Date.now() + 3600_000),
    refreshExpiresAt: new Date(Date.now() + 30 * 24 * 3600_000),
    defaultItemId: "service-item",
    verifiedAt: new Date(),
    connectedById: admin.userId,
  }).returning();
  await h.db.insert(qboCustomerLinks).values({
    connectionId: connection!.id,
    firmId,
    clientId,
    qboCustomerId: "customer-1",
    displayName: "Client with schedule",
    createdById: admin.userId,
  });
}

beforeAll(async () => {
  h = await createTestDb();
});

afterAll(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await h.close();
});

beforeEach(() => {
  vi.stubEnv("QBO_CLIENT_ID", config.clientId!);
  vi.stubEnv("QBO_CLIENT_SECRET", config.clientSecret!);
  vi.stubEnv("APP_URL", config.appUrl!);
  vi.stubEnv("QBO_REDIRECT_URI", config.redirectUri!);
  vi.stubEnv("QBO_TOKEN_ENCRYPTION_KEY", KEY);
  vi.stubEnv("QBO_ENVIRONMENT", "sandbox");
  vi.stubEnv("QBO_FIRM_FINANCIAL_ACTIONS_ENABLED", "1");
  externalCreateCount = 0;
  const external = { Id: "recurring-invoice-1", SyncToken: "0", DocNumber: "R-1", TotalAmt: 250, Balance: 250, InvoiceLink: "https://quickbooks.example/invoice/recurring" };
  fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/invoice") && init?.method === "POST") {
      externalCreateCount += 1;
      return Response.json({ Invoice: external });
    }
    if (url.pathname.endsWith("/invoice/recurring-invoice-1/send")) return Response.json({});
    if (url.pathname.endsWith("/invoice/recurring-invoice-1")) return Response.json({ Invoice: external });
    throw new Error(`Unexpected QuickBooks test request: ${String(init?.method ?? "GET")} ${url.pathname}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});

describe("recurring QuickBooks invoices", () => {
  it("creates a local schedule with explicit firm/client isolation and no card auto-charge", async () => {
    await setupFirm();
    const schedule = await createSubscriptionPlan(h.db, admin, clientId, {
      name: "Monthly bookkeeping",
      amountCents: "250",
      interval: "month",
    }, new Date("2026-11-12T10:00:00Z"));
    expect(schedule).toMatchObject({ status: "active", amountCents: 25000, interval: "month", legacyBilling: false });
    expect(schedule.nextBillingAt?.toISOString()).toBe("2026-11-12T10:00:00.000Z");
    expect(await listPortalSubscriptions(h.db, portal)).toHaveLength(1);
    expect(externalCreateCount).toBe(0);

    const otherFirm = await createTestFirm(h.db, "Isolated Schedule Firm");
    const otherAdmin = await createUser(h.db, { role: "admin", firmId: otherFirm });
    await expect(createSubscriptionPlan(h.db, otherAdmin, clientId, { name: "Bad", amountCents: "50", interval: "year" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(createSubscriptionPlan(h.db, portal, clientId, { name: "Bad", amountCents: "50", interval: "year" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("retries the same billing period without creating a duplicate QuickBooks invoice", async () => {
    await setupFirm();
    const scheduledAt = new Date("2026-11-12T10:00:00Z");
    const schedule = await createSubscriptionPlan(h.db, admin, clientId, {
      name: "Monthly bookkeeping",
      amountCents: "250",
      interval: "month",
    }, scheduledAt);
    const due = (await listDueSubscriptions(h.db, scheduledAt)).find((candidate) => candidate.id === schedule.id);
    expect(due).toBeDefined();
    const first = await issueScheduledInvoice(h.db, due!, scheduledAt);
    const retry = await issueScheduledInvoice(h.db, due!, scheduledAt);
    expect(first).toMatchObject({ status: "sent", qboInvoiceId: "recurring-invoice-1", subscriptionId: schedule.id });
    expect(retry.id).toBe(first.id);
    expect(externalCreateCount).toBe(1);
    expect(fetchMock.mock.calls.filter(([url, init]) => String(url).includes("/invoice/recurring-invoice-1/send?") && init?.method === "POST")).toHaveLength(1);
    const rows = await h.db.select().from(invoices).where(and(eq(invoices.subscriptionId, schedule.id), eq(invoices.billingPeriodStart, "2026-11-12")));
    expect(rows).toHaveLength(1);
    const updated = await h.db.select().from(subscriptions).where(eq(subscriptions.id, schedule.id));
    expect(updated[0]?.nextBillingAt?.toISOString()).toBe("2026-12-12T10:00:00.000Z");
  });

  it("stops future invoices when an administrator cancels the schedule", async () => {
    await setupFirm();
    const schedule = await createSubscriptionPlan(h.db, admin, clientId, { name: "Annual tax", amountCents: "1200", interval: "year" });
    await cancelSubscription(h.db, admin, schedule.id);
    expect((await h.db.select().from(subscriptions).where(eq(subscriptions.id, schedule.id)))[0]?.status).toBe("cancelled");
    await expect(cancelSubscription(h.db, portal, schedule.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("does not create schedules before the QuickBooks financial gate is enabled", async () => {
    await setupFirm();
    vi.stubEnv("QBO_FIRM_FINANCIAL_ACTIONS_ENABLED", "0");
    await expect(createSubscriptionPlan(h.db, admin, clientId, { name: "Monthly", amountCents: "250", interval: "month" })).rejects.toBeInstanceOf(IntegrationNotConfiguredError);
    expect(externalCreateCount).toBe(0);
  });
});
