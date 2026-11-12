import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
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

export async function requireStaffActor(): Promise<Actor> {
  const actor = await getCurrentActor();
  if (!actor) redirect("/login");
  if (actor.role === "client") redirect("/portal");
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
