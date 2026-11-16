import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import type { DbHandle } from "@/db";
import { auditEvents, clients, invoices, qboConnections, qboCustomerLinks } from "@/db/schema";
import { encryptToken } from "@/integrations/qbo";
import type { QboConfig } from "@/integrations/qbo";
import type { Actor } from "@/lib/auth/actor";
import { IntegrationNotConfiguredError, NotFoundError, ValidationError } from "@/lib/errors";
import { cancelInvoice, createInvoice, refreshInvoice } from "@/services/invoices";
import { createTestDb, createTestFirm, createUser } from "./helpers";

const KEY = Buffer.alloc(32, 7).toString("base64");
const config: QboConfig = {
  clientId: "test-client",
  clientSecret: "test-secret",
  appUrl: "http://localhost:3000",
  redirectUri: "http://localhost:3000/api/integrations/qbo/callback",
  tokenEncryptionKey: KEY,
  environment: "sandbox",
};

interface RemoteInvoice {
  Id: string;
  SyncToken: string;
  DocNumber: string;
  TotalAmt: number;
  Balance: number;
  TxnStatus?: string;
  InvoiceLink: string;
}

let h: DbHandle;
let requestCount: number;
let remote: RemoteInvoice | null;
let fetchMock: ReturnType<typeof vi.fn>;
let admin: Actor;
let clientId: string;
let firmId: string;

const form = (requestId: string, title = "Tax preparation") => ({
  requestId,
  title,
  dueDate: "2027-04-15",
  item0Name: "Form preparation",
  item0Qty: "1",
  item0Amount: "350.00",
});

async function setupFirm() {
  firmId = await createTestFirm(h.db, `Firm ${crypto.randomUUID()}`);
  admin = await createUser(h.db, { role: "admin", firmId });
  const [client] = await h.db.insert(clients).values({
    firmId,
    type: "individual",
    displayName: "Jordan Sample",
    email: "jordan@example.test",
    createdById: admin.userId,
  }).returning();
  clientId = client!.id;
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
    displayName: "Jordan Sample",
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
  requestCount = 0;
  remote = null;
  fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    if (url.pathname.endsWith("/invoice") && url.searchParams.get("operation") === "void") {
      if (remote) remote.TxnStatus = "Voided";
      return Response.json({ Invoice: remote });
    }
    if (url.pathname.endsWith("/invoice") && method === "POST") {
      requestCount += 1;
      const body = JSON.parse(String(init?.body)) as { Line: { Amount: number }[] };
      const total = body.Line.reduce((sum, line) => sum + line.Amount, 0);
      remote = { Id: "qbo-invoice-1", SyncToken: "0", DocNumber: "INV-1", TotalAmt: total, Balance: total, InvoiceLink: "https://quickbooks.example/invoice/1" };
      return Response.json({ Invoice: remote });
    }
    if (url.pathname.endsWith("/invoice/qbo-invoice-1/send")) return Response.json({});
    if (url.pathname.endsWith("/invoice/qbo-invoice-1") && method === "GET") return Response.json({ Invoice: remote });
    throw new Error(`Unexpected QuickBooks test request: ${method} ${url.pathname}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});

describe("QuickBooks invoices", () => {
  it("creates and sends one invoice with a stable request key and hosted payment link", async () => {
    await setupFirm();
    const key = crypto.randomUUID();
    const first = await createInvoice(h.db, admin, clientId, form(key));
    const retry = await createInvoice(h.db, admin, clientId, form(key));
    expect(first).toMatchObject({
      status: "sent",
      qboInvoiceId: "qbo-invoice-1",
      qboInvoiceNumber: "INV-1",
      payUrl: "https://quickbooks.example/invoice/1",
      totalCents: 35000,
    });
    expect(retry.id).toBe(first.id);
    expect(requestCount).toBe(1);
    expect(fetchMock.mock.calls.filter(([url, init]) => String(url).includes("/invoice/qbo-invoice-1/send?") && init?.method === "POST")).toHaveLength(1);
  });

  it("syncs partial and full payments and records the paid audit event once", async () => {
    await setupFirm();
    const invoice = await createInvoice(h.db, admin, clientId, form(crypto.randomUUID()));
    remote!.Balance = 1;
    expect((await refreshInvoice(h.db, admin, invoice.id)).paidCents).toBe(34900);
    remote!.Balance = 0;
    await refreshInvoice(h.db, admin, invoice.id);
    await refreshInvoice(h.db, admin, invoice.id);
    const stored = await h.db.select().from(invoices).where(eq(invoices.id, invoice.id));
    expect(stored[0]?.status).toBe("paid");
    const events = await h.db.select().from(auditEvents).where(and(eq(auditEvents.entityType, "invoice"), eq(auditEvents.entityId, invoice.id)));
    expect(events.filter((event) => event.action === "invoice.paid")).toHaveLength(1);
  });

  it("voids an unpaid invoice in QuickBooks", async () => {
    await setupFirm();
    const invoice = await createInvoice(h.db, admin, clientId, form(crypto.randomUUID()));
    await cancelInvoice(h.db, admin, invoice.id);
    expect(remote?.TxnStatus).toBe("Voided");
    expect((await h.db.select().from(invoices).where(eq(invoices.id, invoice.id)))[0]?.status).toBe("cancelled");
  });

  it("requires an explicit customer match and blocks cross-firm billing", async () => {
    await setupFirm();
    await h.db.delete(qboCustomerLinks).where(eq(qboCustomerLinks.clientId, clientId));
    await expect(createInvoice(h.db, admin, clientId, form(crypto.randomUUID()))).rejects.toBeInstanceOf(IntegrationNotConfiguredError);
    const otherFirm = await createTestFirm(h.db, "Other QBO Firm");
    const otherAdmin = await createUser(h.db, { role: "admin", firmId: otherFirm });
    await expect(createInvoice(h.db, otherAdmin, clientId, form(crypto.randomUUID()))).rejects.toBeInstanceOf(NotFoundError);
    expect(requestCount).toBe(0);
  });

  it("keeps invoices disabled until the deployment gate is enabled", async () => {
    await setupFirm();
    vi.stubEnv("QBO_FIRM_FINANCIAL_ACTIONS_ENABLED", "0");
    await expect(createInvoice(h.db, admin, clientId, form(crypto.randomUUID()))).rejects.toBeInstanceOf(IntegrationNotConfiguredError);
    expect(requestCount).toBe(0);
  });

  it("rejects reuse of an idempotency key with changed invoice details", async () => {
    await setupFirm();
    const key = crypto.randomUUID();
    await createInvoice(h.db, admin, clientId, form(key));
    await expect(createInvoice(h.db, admin, clientId, form(key, "Different invoice"))).rejects.toBeInstanceOf(ValidationError);
    expect(requestCount).toBe(1);
  });
});
