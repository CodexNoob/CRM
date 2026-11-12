import { getDb } from "@/db";
import { getCurrentActor, getCurrentFirmAccess } from "@/lib/auth/current";
import { NotFoundError } from "@/lib/errors";
import { getDocumentForDownload } from "@/services/documents";

/**
 * Authenticated, authorized file download. Files are always sent as
 * attachments (never rendered inline) with no-store caching, so a malicious
 * upload cannot run in the app's origin and copies aren't left in caches.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getCurrentActor();
  if (!actor) return new Response("Not found", { status: 404 });
  // Staff of a firm whose subscription has lapsed are limited to the Subscription page; clients keep access.
  if (actor.role !== "client" && (await getCurrentFirmAccess(actor.firmId)).locked) return new Response("Subscription required", { status: 402 });
  try {
    const { doc, data } = await getDocumentForDownload(getDb(), actor, (await params).id);
    const asciiName = doc.fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": doc.contentType,
        "Content-Length": String(data.length),
        "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(doc.fileName)}`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch (error) {
    if (error instanceof NotFoundError) return new Response("Not found", { status: 404 });
    console.error("Document download failed", { name: (error as Error)?.name });
    return new Response("Something went wrong", { status: 500 });
  }
}
