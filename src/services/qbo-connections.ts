import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import type { Db } from "@/db";
import { clients, qboConnections, qboCustomerLinks, qboOAuthStates } from "@/db/schema";
import type { Actor } from "@/lib/auth/actor";
import { isOwner } from "@/lib/auth/actor";
import { ForbiddenError, IntegrationNotConfiguredError, NotFoundError, ValidationError } from "@/lib/errors";
import {
  authorizationUrl,
  decryptToken,
  encryptToken,
  exchangeAuthorizationCode,
  getCompanyInfo,
  listCustomers,
  listServiceItems,
  readQboConfig,
  revokeToken,
  refreshTokens,
  type QboConfig,
  type QboScope,
  type QboTokenSet,
} from "@/integrations/qbo";
import { inFirm } from "./access";

const STATE_TTL_MS = 10 * 60_000;
const ACCESS_REFRESH_SKEW_MS = 60_000;

export function assertCanManageQbo(actor: Actor, scope: QboScope) {
  if (!isOwner(actor) || actor.firmId !== scope.firmId) {
    throw new ForbiddenError("Only this firm's administrator can manage its QuickBooks connection.");
  }
}

function scopeCondition(scope: QboScope) {
  return and(eq(qboConnections.scope, "firm"), eq(qboConnections.firmId, scope.firmId));
}

export function qboFirmFinancialActionsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.QBO_FIRM_FINANCIAL_ACTIONS_ENABLED === "1";
}

export async function getClientQboBillingReadiness(db: Db, firmId: string, clientId: string): Promise<{ ready: boolean; message: string }> {
  if (!qboFirmFinancialActionsEnabled()) return { ready: false, message: "Firm QuickBooks billing is disabled until the sandbox invoice/payment workflow is verified and enabled." };
  const [connection] = await db.select({
    id: qboConnections.id,
    status: qboConnections.status,
    defaultItemId: qboConnections.defaultItemId,
    verifiedAt: qboConnections.verifiedAt,
    refreshExpiresAt: qboConnections.refreshExpiresAt,
  }).from(qboConnections).where(scopeCondition({ type: "firm", firmId })).limit(1);
  if (!connection || connection.status !== "connected" || connection.refreshExpiresAt <= new Date()) {
    return { ready: false, message: "Connect or reconnect this firm’s QuickBooks company in Integrations." };
  }
  if (!connection.verifiedAt) return { ready: false, message: "Verify the QuickBooks company connection in Integrations." };
  if (!connection.defaultItemId) return { ready: false, message: "Choose an active QuickBooks service item in Integrations." };
  const [match] = await db.select({ id: qboCustomerLinks.id }).from(qboCustomerLinks)
    .where(and(
      eq(qboCustomerLinks.connectionId, connection.id),
      eq(qboCustomerLinks.firmId, firmId),
      eq(qboCustomerLinks.clientId, clientId),
    )).limit(1);
  if (!match) return { ready: false, message: "Match this client to an existing QuickBooks customer before billing." };
  return { ready: true, message: "QuickBooks connection, customer match, and invoice service item are ready." };
}

export async function beginQboOAuth(db: Db, actor: Actor, scope: QboScope, config: QboConfig = readQboConfig(), now = new Date()): Promise<string> {
  assertCanManageQbo(actor, scope);
  const state = randomBytes(32).toString("base64url");
  const stateHash = createHash("sha256").update(state).digest("hex");
  await db.insert(qboOAuthStates).values({
    stateHash,
    scope: "firm",
    firmId: scope.firmId,
    createdById: actor.userId,
    expiresAt: new Date(now.getTime() + STATE_TTL_MS),
  });
  return authorizationUrl(state, config);
}

export interface QboOAuthState {
  scope: { type: "firm"; firmId: string };
  createdById: string;
}

export async function consumeQboOAuthState(
  db: Db,
  actor: Actor,
  state: string,
  config: QboConfig = readQboConfig(),
  now = new Date(),
): Promise<QboOAuthState> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(state)) throw new ForbiddenError("QuickBooks connection state is invalid or expired.");
  const stateHash = createHash("sha256").update(state).digest("hex");
  const record = await db.transaction(async (tx) => {
    const [row] = await tx.select().from(qboOAuthStates).where(and(eq(qboOAuthStates.stateHash, stateHash), gt(qboOAuthStates.expiresAt, now))).for("update").limit(1);
    if (!row || row.createdById !== actor.userId) return null;
    await tx.delete(qboOAuthStates).where(eq(qboOAuthStates.stateHash, stateHash));
    return row;
  });
  if (!record) throw new ForbiddenError("QuickBooks connection state is invalid or expired.");
  const scope: QboScope = { type: "firm", firmId: record.firmId };
  assertCanManageQbo(actor, scope);
  // Validate the redirect before exchanging the authorization code.
  authorizationUrl(state, config);
  return { scope, createdById: record.createdById };
}

async function saveTokens(
  db: Db,
  scope: QboScope,
  realmId: string,
  companyName: string,
  tokens: QboTokenSet,
  connectedById: string,
  config: QboConfig,
  now: Date,
): Promise<void> {
  const where = scopeCondition(scope);
  const values = {
    scope: scope.type,
    firmId: scope.firmId,
    realmId,
    companyName: companyName.slice(0, 200),
    accessTokenEncrypted: encryptToken(tokens.accessToken, config),
    refreshTokenEncrypted: encryptToken(tokens.refreshToken, config),
    accessExpiresAt: tokens.accessExpiresAt,
    refreshExpiresAt: tokens.refreshExpiresAt,
    status: "connected" as const,
    verifiedAt: now,
    connectedById,
    updatedAt: now,
  };
  const [existing] = await db.select({ id: qboConnections.id }).from(qboConnections).where(where).limit(1);
  if (existing) {
    await db.update(qboConnections).set(values).where(eq(qboConnections.id, existing.id));
  } else {
    await db.insert(qboConnections).values(values);
  }
}

export async function completeQboOAuth(
  db: Db,
  actor: Actor,
  scope: QboScope,
  realmId: string,
  code: string,
  config: QboConfig = readQboConfig(),
  now = new Date(),
): Promise<void> {
  assertCanManageQbo(actor, scope);
  if (!/^[A-Za-z0-9.-]{1,128}$/.test(realmId)) throw new IntegrationNotConfiguredError("QuickBooks Online", "QuickBooks returned an invalid company identifier.");
  const tokens = await exchangeAuthorizationCode(code, config);
  const companyName = await getCompanyInfo(tokens.accessToken, realmId, config);
  await saveTokens(db, scope, realmId, companyName, tokens, actor.userId, config, now);
}

export interface QboConnectionView {
  connected: boolean;
  companyName: string | null;
  status: "not_connected" | "connected" | "reauthorization_required" | "expired";
  verified: boolean;
  defaultItemId: string | null;
}

export async function getQboClientCustomerLink(db: Db, actor: Actor, clientId: string): Promise<{ customerId: string; displayName: string } | null> {
  if (!isOwner(actor) || !clientId) throw new ForbiddenError("Only the firm Owner can view QuickBooks customer matches.");
  const [connection] = await db.select({ id: qboConnections.id }).from(qboConnections)
    .where(scopeCondition({ type: "firm", firmId: actor.firmId })).limit(1);
  if (!connection) return null;
  const [link] = await db.select({ customerId: qboCustomerLinks.qboCustomerId, displayName: qboCustomerLinks.displayName })
    .from(qboCustomerLinks).where(and(
      eq(qboCustomerLinks.connectionId, connection.id),
      eq(qboCustomerLinks.firmId, actor.firmId),
      eq(qboCustomerLinks.clientId, clientId),
    )).limit(1);
  return link ?? null;
}

export async function getQboConnectionView(db: Db, scope: QboScope, now = new Date()): Promise<QboConnectionView> {
  const [row] = await db.select().from(qboConnections).where(scopeCondition(scope)).limit(1);
  if (!row) return { connected: false, companyName: null, status: "not_connected", verified: false, defaultItemId: null };
  if (row.status !== "connected") return { connected: false, companyName: row.companyName, status: "reauthorization_required", verified: false, defaultItemId: row.defaultItemId };
  if (row.refreshExpiresAt <= now) {
    await db.update(qboConnections).set({ status: "reauthorization_required", updatedAt: now }).where(eq(qboConnections.id, row.id));
    return { connected: false, companyName: row.companyName, status: "expired", verified: false, defaultItemId: row.defaultItemId };
  }
  return { connected: true, companyName: row.companyName, status: "connected", verified: !!row.verifiedAt, defaultItemId: row.defaultItemId };
}

export async function getQboAccessToken(db: Db, scope: QboScope, config: QboConfig = readQboConfig(), now = new Date()): Promise<{ accessToken: string; realmId: string; connectionId: string; defaultItemId: string | null }> {
  const result = await db.transaction(async (tx) => {
    const [row] = await tx.select().from(qboConnections).where(scopeCondition(scope)).for("update").limit(1);
    if (!row) return { error: "not_connected" as const };
    if (row.status !== "connected" || row.refreshExpiresAt <= now) {
      await tx.update(qboConnections).set({ status: "reauthorization_required", updatedAt: now }).where(eq(qboConnections.id, row.id));
      return { error: "reauthorization_required" as const };
    }
    if (row.accessExpiresAt.getTime() > now.getTime() + ACCESS_REFRESH_SKEW_MS) {
      return {
        accessToken: decryptToken(row.accessTokenEncrypted, config),
        realmId: row.realmId,
        connectionId: row.id,
        defaultItemId: row.defaultItemId,
      };
    }
    let tokens: QboTokenSet;
    try {
      tokens = await refreshTokens(decryptToken(row.refreshTokenEncrypted, config), config);
    } catch (error) {
      if (error instanceof Error && "status" in error && [400, 401].includes(Number((error as { status: unknown }).status))) {
        await tx.update(qboConnections).set({ status: "reauthorization_required", updatedAt: now }).where(eq(qboConnections.id, row.id));
        return { error: "reauthorization_required" as const };
      }
      throw error;
    }
    await tx.update(qboConnections).set({
      accessTokenEncrypted: encryptToken(tokens.accessToken, config),
      refreshTokenEncrypted: encryptToken(tokens.refreshToken, config),
      accessExpiresAt: tokens.accessExpiresAt,
      refreshExpiresAt: tokens.refreshExpiresAt,
      updatedAt: now,
    }).where(eq(qboConnections.id, row.id));
    return { accessToken: tokens.accessToken, realmId: row.realmId, connectionId: row.id, defaultItemId: row.defaultItemId };
  });
  if ("error" in result) {
    throw new IntegrationNotConfiguredError("QuickBooks Online", result.error === "not_connected"
      ? "No QuickBooks company is connected."
      : "QuickBooks authorization expired or was revoked. An administrator must reconnect the company.");
  }
  return result;
}

export async function verifyQboConnection(db: Db, actor: Actor, scope: QboScope, config: QboConfig = readQboConfig(), now = new Date()): Promise<string> {
  assertCanManageQbo(actor, scope);
  const token = await getQboAccessToken(db, scope, config, now);
  const companyName = await getCompanyInfo(token.accessToken, token.realmId, config);
  await db.update(qboConnections).set({ companyName, verifiedAt: now, updatedAt: now }).where(eq(qboConnections.id, token.connectionId));
  return companyName;
}

export async function disconnectQbo(db: Db, actor: Actor, scope: QboScope): Promise<void> {
  assertCanManageQbo(actor, scope);
  const [row] = await db.select().from(qboConnections).where(scopeCondition(scope)).limit(1);
  if (!row) throw new NotFoundError("QuickBooks connection not found.");
  await db.update(qboConnections).set({ status: "reauthorization_required", updatedAt: new Date() }).where(eq(qboConnections.id, row.id));
  let revokeFailed = false;
  try {
    await revokeToken(decryptToken(row.refreshTokenEncrypted), readQboConfig());
  } catch {
    revokeFailed = true;
  }
  await db.delete(qboConnections).where(eq(qboConnections.id, row.id));
  if (revokeFailed) {
    throw new IntegrationNotConfiguredError("QuickBooks Online", "The connection was removed from this CRM, but Intuit could not confirm token revocation. Revoke this app's access in your Intuit account.");
  }
}

export async function listQboCustomers(db: Db, actor: Actor, scope: QboScope, config: QboConfig = readQboConfig()) {
  assertCanManageQbo(actor, scope);
  const token = await getQboAccessToken(db, scope, config);
  return listCustomers(token.accessToken, token.realmId, config);
}

export async function listQboItems(db: Db, actor: Actor, scope: QboScope, config: QboConfig = readQboConfig()) {
  assertCanManageQbo(actor, scope);
  const token = await getQboAccessToken(db, scope, config);
  return listServiceItems(token.accessToken, token.realmId, config);
}

export async function setQboDefaultItem(db: Db, actor: Actor, scope: QboScope, itemId: string, config: QboConfig = readQboConfig()): Promise<void> {
  assertCanManageQbo(actor, scope);
  const token = await getQboAccessToken(db, scope, config);
  const items = await listServiceItems(token.accessToken, token.realmId, config);
  const item = items.find((entry) => entry.id === itemId);
  if (!item) throw new ValidationError({ itemId: ["Choose an active service item from this QuickBooks company."] });
  await db.update(qboConnections).set({ defaultItemId: item.id, updatedAt: new Date() }).where(eq(qboConnections.id, token.connectionId));
}

export async function linkQboCustomer(
  db: Db,
  actor: Actor,
  scope: QboScope,
  clientId: string,
  qboCustomerId: string,
  config: QboConfig = readQboConfig(),
): Promise<void> {
  assertCanManageQbo(actor, scope);
  const firmId = scope.firmId;
  const [client] = await db.select({ id: clients.id }).from(clients)
    .where(and(eq(clients.id, clientId), inFirm(clients.firmId, actor))).limit(1);
  if (!client) throw new NotFoundError();
  const token = await getQboAccessToken(db, scope, config);
  const customer = (await listCustomers(token.accessToken, token.realmId, config)).find((entry) => entry.id === qboCustomerId);
  if (!customer) throw new ValidationError({ qboCustomerId: ["Choose a customer from the connected QuickBooks company."] });

  try {
    await db.transaction(async (tx) => {
      await tx.delete(qboCustomerLinks).where(and(
        eq(qboCustomerLinks.firmId, firmId),
        eq(qboCustomerLinks.clientId, clientId),
      ));
      await tx.insert(qboCustomerLinks).values({
        connectionId: token.connectionId,
        firmId,
        clientId,
        qboCustomerId: customer.id,
        displayName: customer.displayName,
        createdById: actor.userId,
      });
    });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "";
    if (code === "23505") throw new ValidationError({ qboCustomerId: ["That QuickBooks customer is already matched to another record."] });
    throw error;
  }
}
