import { cookies } from "next/headers";
import { getDb } from "@/db";
import { getCurrentActor, getCurrentFirmAccess } from "@/lib/auth/current";
import { PORTAL_CLIENT_COOKIE } from "@/lib/auth/portal-context";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { prepareDownload } from "@/services/documents";
import { resolvePortalClient } from "@/services/portal-access";

/**
 * Authenticated, authorized file access. Every request re-checks access (prepareDownload).
 *  - Private bucket: redirects to a 60-second signed URL (never a public link).
 *  - Database storage: streams the bytes with no-store caching.
 * `?inline=1` previews PDFs/images only, inside a sandbox CSP; everything else is an attachment,
 * so a malicious upload can't run in the app's origin.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getCurrentActor();
  if (!actor) return new Response("Not found", { status: 404 });
  // Staff of a firm whose subscription has lapsed are limited to the Subscription page; clients keep access.
  if (actor.role !== "client" && (await getCurrentFirmAccess(actor.firmId)).locked) return new Response("Subscription required", { status: 402 });
  const inline = new URL(request.url).searchParams.get("inline") === "1";
  try {
    const db = getDb();
    // Portal users act for the server-resolved client (the cookie is only a hint).
    const portalClientId = actor.role === "client" ? (await resolvePortalClient(db, actor, (await cookies()).get(PORTAL_CLIENT_COOKIE)?.value)).clientId : undefined;
    const prepared = await prepareDownload(db, actor, (await params).id, { inline, portalClientId });
    if (prepared.kind === "redirect") {
      return new Response(null, { status: 302, headers: { Location: prepared.url, "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
    }
    const { doc, data } = prepared;
    const asciiName = doc.fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
    const disposition = prepared.inline ? "inline" : "attachment";
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": doc.contentType,
        "Content-Length": String(data.length),
        "Content-Disposition": `${disposition}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(doc.fileName)}`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
        "Referrer-Policy": "no-referrer",
        // Previews may render PDFs/images but nothing can script, navigate or reach the network.
        "Content-Security-Policy": prepared.inline ? "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox" : "default-src 'none'; sandbox",
      },
    });
  } catch (error) {
    if (error instanceof NotFoundError) return new Response("Not found", { status: 404 });
    if (error instanceof ForbiddenError) return new Response("Forbidden", { status: 403 });
    console.error("Document download failed", { name: (error as Error)?.name });
    return new Response("Something went wrong", { status: 500 });
  }
}
