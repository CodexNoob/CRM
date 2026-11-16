import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db";
import { PayPalError, verifyWebhookSignature } from "@/integrations/paypal";
import { IntegrationNotConfiguredError, ValidationError } from "@/lib/errors";
import { processPayPalWebhook } from "@/services/firm-billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 256 * 1024;

const headerValue = (request: NextRequest, name: string) => request.headers.get(name) ?? "";

export async function POST(request: NextRequest) {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Webhook request is too large." }, { status: 413 });
  }
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return NextResponse.json({ error: "Expected a JSON webhook event." }, { status: 415 });
  }

  let event: unknown;
  try {
    const body = await request.text();
    if (Buffer.byteLength(body) > MAX_BODY_BYTES) return NextResponse.json({ error: "Webhook request is too large." }, { status: 413 });
    event = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Webhook event is invalid." }, { status: 400 });
  }
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    return NextResponse.json({ error: "Webhook event is invalid." }, { status: 400 });
  }

  try {
    const verified = await verifyWebhookSignature({
      authAlgo: headerValue(request, "paypal-auth-algo"),
      certUrl: headerValue(request, "paypal-cert-url"),
      transmissionId: headerValue(request, "paypal-transmission-id"),
      transmissionSignature: headerValue(request, "paypal-transmission-sig"),
      transmissionTime: headerValue(request, "paypal-transmission-time"),
    }, event as Record<string, unknown>);
    if (!verified) return NextResponse.json({ error: "Webhook signature verification failed." }, { status: 401 });
    const result = await processPayPalWebhook(getDb(), event);
    return NextResponse.json({ received: true, result });
  } catch (error) {
    console.error("PayPal webhook processing failed", { error: error instanceof Error ? error.name : "UnknownError" });
    const status = error instanceof IntegrationNotConfiguredError || error instanceof PayPalError
      ? 503
      : error instanceof ValidationError
        ? 400
        : 500;
    return NextResponse.json({ error: status === 503 ? "PayPal webhook verification is temporarily unavailable." : "Webhook processing failed." }, { status });
  }
}
