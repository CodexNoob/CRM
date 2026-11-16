import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { DbHandle } from "@/db";
import { qboConnections, qboOAuthStates } from "@/db/schema";
import { decryptToken, encryptToken, type QboConfig } from "@/integrations/qbo";
import type { Actor } from "@/lib/auth/actor";
import { ForbiddenError, IntegrationNotConfiguredError } from "@/lib/errors";
import { getQboAccessToken, beginQboOAuth, consumeQboOAuthState, listQboCustomers } from "@/services/qbo-connections";
import { createTestDb, createTestFirm, createUser } from "./helpers";

const KEY = Buffer.alloc(32, 11).toString("base64");
const config: QboConfig = {
  clientId: "intuit-client-id",
  clientSecret: "intuit-client-secret",
  appUrl: "http://localhost:3000",
  redirectUri: "http://localhost:3000/api/integrations/qbo/callback",
  tokenEncryptionKey: KEY,
  environment: "sandbox",
};

let h: DbHandle;

async function addConnection(actor: Actor, realmId = "sandbox-company", accessExpiresAt = new Date(Date.now() + 3600_000)) {
  const [connection] = await h.db.insert(qboConnections).values({
    scope: "firm",
    firmId: actor.firmId,
    realmId,
    companyName: "QuickBooks Test Sandbox",
    accessTokenEncrypted: encryptToken("access-token", config),
    refreshTokenEncrypted: encryptToken("refresh-token", config),
    accessExpiresAt,
    refreshExpiresAt: new Date(Date.now() + 30 * 24 * 3600_000),
    defaultItemId: "service-item",
    verifiedAt: new Date(),
    connectedById: actor.userId,
  }).returning();
  return connection!;
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
});

describe("QuickBooks OAuth security", () => {
  it("uses a one-time hashed state bound to the initiating administrator and exact callback", async () => {
    const firmId = await createTestFirm(h.db, `OAuth Firm ${crypto.randomUUID()}`);
    const admin = await createUser(h.db, { role: "admin", firmId });
    const otherAdmin = await createUser(h.db, { role: "admin", firmId });
    const url = new URL(await beginQboOAuth(h.db, admin, { type: "firm", firmId }, config));
    const state = url.searchParams.get("state")!;
    const row = (await h.db.select().from(qboOAuthStates))[0]!;
    expect(row.stateHash).not.toBe(state);
    expect(url.searchParams.get("redirect_uri")).toBe(config.redirectUri);
    await expect(consumeQboOAuthState(h.db, otherAdmin, state, config)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await consumeQboOAuthState(h.db, admin, state, config)).scope).toEqual({ type: "firm", firmId });
    await expect(consumeQboOAuthState(h.db, admin, state, config)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(beginQboOAuth(h.db, admin, { type: "firm", firmId }, { ...config, redirectUri: "https://attacker.example/callback" }))
      .rejects.toBeInstanceOf(IntegrationNotConfiguredError);
  });

  it("refreshes expiring tokens and rotates both encrypted token values", async () => {
    const firmId = await createTestFirm(h.db, `Refresh Firm ${crypto.randomUUID()}`);
    const admin = await createUser(h.db, { role: "admin", firmId });
    const connection = await addConnection(admin, "refresh-company", new Date(Date.now() - 1000));
    const fetchMock = vi.fn(async () => Response.json({
      access_token: "rotated-access",
      refresh_token: "rotated-refresh",
      expires_in: 3600,
      x_refresh_token_expires_in: 86400,
    }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await getQboAccessToken(h.db, { type: "firm", firmId }, config);
    const [stored] = await h.db.select().from(qboConnections).where(eq(qboConnections.id, connection.id));
    expect(result.accessToken).toBe("rotated-access");
    expect(stored?.accessTokenEncrypted).not.toContain("rotated-access");
    expect(stored?.refreshTokenEncrypted).not.toContain("rotated-refresh");
    expect(decryptToken(stored!.accessTokenEncrypted, config)).toBe("rotated-access");
    expect(decryptToken(stored!.refreshTokenEncrypted, config)).toBe("rotated-refresh");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("prevents one firm's administrator from using another firm's QBO connection", async () => {
    const firstFirm = await createTestFirm(h.db, `First ${crypto.randomUUID()}`);
    const secondFirm = await createTestFirm(h.db, `Second ${crypto.randomUUID()}`);
    const firstAdmin = await createUser(h.db, { role: "admin", firmId: firstFirm });
    await createUser(h.db, { role: "admin", firmId: secondFirm });
    await addConnection(firstAdmin);
    await expect(listQboCustomers(h.db, firstAdmin, { type: "firm", firmId: secondFirm }, config))
      .rejects.toBeInstanceOf(ForbiddenError);
  });
});
