import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { firmAccess, syncFirmBilling, type FirmAccess } from "@/services/firm-billing";
import type { Actor } from "./actor";
import { SESSION_ABSOLUTE_MS, validateSessionToken } from "./sessions";

const isProd = process.env.NODE_ENV === "production";
/** `__Host-` prefix pins the cookie to this host, HTTPS and path=/ in production. */
export const SESSION_COOKIE = isProd ? "__Host-crm_session" : "crm_session";

/** The signed-in actor for this request (validated against the database), or null. */
export const getCurrentActor = cache(async (): Promise<Actor | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return validateSessionToken(getDb(), token);
});

/** The signed-in staff member's firm access (trial / active / locked), refreshed from PayPal at most every few minutes. */
export const getCurrentFirmAccess = cache(async (firmId: string): Promise<FirmAccess> => {
  const firm = await syncFirmBilling(getDb(), firmId);
  return firmAccess(firm);
});

/**
 * Every staff page and Server Action calls this. When the firm's trial has ended or its
 * subscription has lapsed, every page and action redirects to the dashboard, where the
 * staff layout shows the subscription modal that cannot be closed (and renders no CRM data).
 * Only the dashboard, the shared layout and the subscription actions pass `allowLocked`.
 */
export async function requireStaffActor(opts: { allowLocked?: boolean } = {}): Promise<Actor> {
  const actor = await getCurrentActor();
  if (!actor) redirect("/login");
  if (actor.role === "client") redirect("/portal");
  if (!opts.allowLocked && (await getCurrentFirmAccess(actor.firmId)).locked) redirect("/staff");
  return actor;
}

export async function requireClientActor(): Promise<Actor> {
  const actor = await getCurrentActor();
  if (!actor) redirect("/login");
  if (actor.role !== "client") redirect("/staff");
  return actor;
}

/** Only callable from Server Actions / Route Handlers. */
export async function setSessionCookie(token: string): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(SESSION_ABSOLUTE_MS / 1000),
  });
}

export async function readSessionCookie(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}
