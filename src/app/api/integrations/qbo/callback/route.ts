import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db";
import { exactRedirectUri, readQboConfig } from "@/integrations/qbo";
import { requireStaffActor } from "@/lib/auth/current";
import { completeQboOAuth, consumeQboOAuthState } from "@/services/qbo-connections";

export const dynamic = "force-dynamic";

function integrationUrl(request: NextRequest, result: "connected" | "cancelled" | "error"): URL {
  const url = new URL("/staff/integrations", request.url);
  url.searchParams.set("qbo", result);
  return url;
}

export async function GET(request: NextRequest) {
  const config = readQboConfig();
  const callback = new URL(request.url);
  let destination = integrationUrl(request, "error");
  try {
    if (`${callback.origin}${callback.pathname}` !== exactRedirectUri(config)) return NextResponse.redirect(destination);
    const state = callback.searchParams.get("state") ?? "";
    const actor = await requireStaffActor({ allowLocked: true });
    const consumed = await consumeQboOAuthState(getDb(), actor, state, config);
    destination = integrationUrl(request, callback.searchParams.has("error") ? "cancelled" : "connected");
    if (callback.searchParams.has("error")) return NextResponse.redirect(destination);
    const code = callback.searchParams.get("code") ?? "";
    const realmId = callback.searchParams.get("realmId") ?? "";
    await completeQboOAuth(getDb(), actor, consumed.scope, realmId, code, config);
    return NextResponse.redirect(destination);
  } catch {
    return NextResponse.redirect(integrationUrl(request, "error"));
  }
}
