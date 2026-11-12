import { getDb } from "@/db";
import { processDropboxSignWebhook } from "@/services/esignatures";

/**
 * Dropbox Sign account callback. No session: authenticity comes from the event hash
 * (HMAC-SHA256 of event_time + event_type with the API key), verified in the service.
 * Dropbox Sign requires the exact reply text below for accepted events.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 256 * 1024;
const ACK = "Hello API Event Received";

export async function POST(request: Request) {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_BYTES) return new Response("Payload too large", { status: 413 });

  let json: string | null = null;
  try {
    const type = request.headers.get("content-type") ?? "";
    if (type.includes("multipart/form-data") || type.includes("application/x-www-form-urlencoded")) {
      const form = await request.formData();
      const value = form.get("json");
      json = typeof value === "string" ? value : null;
    } else {
      json = await request.text();
    }
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  if (!json || json.length > MAX_BYTES) return new Response("Bad request", { status: 400 });

  try {
    const result = await processDropboxSignWebhook(getDb(), json);
    if (result.status !== 200) return new Response(result.status === 401 ? "Unauthorized" : "Bad request", { status: result.status });
    return new Response(ACK, { status: 200, headers: { "Content-Type": "text/plain" } });
  } catch (error) {
    // Let the provider retry; never echo details.
    console.error("Dropbox Sign webhook failed", { name: (error as Error)?.name });
    return new Response("Error", { status: 500 });
  }
}
