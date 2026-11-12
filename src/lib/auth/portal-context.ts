import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { listPortalClients, resolvePortalClient, type PortalClient } from "@/services/portal-access";
import type { Actor } from "./actor";
import { requireClientActor } from "./current";

/** Cookie holding the portal user's chosen client (a HINT only — always re-validated). */
export const PORTAL_CLIENT_COOKIE = "portal_client";

export interface PortalContext {
  actor: Actor;
  /** The client this request acts for — resolved on the server from portal_client_access. */
  client: PortalClient;
  /** Every client this user may switch between. */
  clients: PortalClient[];
}

/**
 * Every portal page and portal Server Action starts here. Portal services must take
 * `ctx.client.clientId` from this — never a client id from the URL, form or body.
 */
export const requirePortalContext = cache(async (): Promise<PortalContext> => {
  const actor = await requireClientActor();
  const db = getDb();
  const hint = (await cookies()).get(PORTAL_CLIENT_COOKIE)?.value ?? null;
  try {
    const [client, clients] = await Promise.all([resolvePortalClient(db, actor, hint), listPortalClients(db, actor)]);
    return { actor, client, clients };
  } catch {
    // No active client access (suspended): the user can't use the portal.
    redirect("/login?portal=suspended");
  }
});
