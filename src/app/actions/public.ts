"use server";

import { headers } from "next/headers";
import { after } from "next/server";
import { notifyPlatformInquiry } from "@/services/notifications";
import { getDb } from "@/db";
import { errorState, formValues, type ActionState } from "@/lib/action-state";
import { SpamRejectedError } from "@/services/leads";
import { createPlatformInquiry } from "@/services/settings";

/**
 * Best-effort per-IP limit (in memory, per server instance): 5 inquiries / 10 min.
 * Production should add an edge/WAF rate limit and a CAPTCHA (see README).
 */
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 5;
const hits = new Map<string, number[]>();

function allow(ip: string, now = Date.now()): boolean {
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) {
    hits.set(ip, recent);
    return false;
  }
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 10_000) hits.clear();
  return true;
}

export async function submitInquiryAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const h = await headers();
    const ip = (h.get("x-forwarded-for") ?? "").split(",")[0]!.trim() || h.get("x-real-ip") || "unknown";
    if (!allow(ip)) throw new SpamRejectedError();
    if (formData.get("website")) throw new SpamRejectedError();
    const startedAt = Number(formData.get("startedAt"));
    if (!Number.isFinite(startedAt) || Date.now() - startedAt < 2_000 || Date.now() - startedAt > 24 * 60 * 60_000) {
      throw new SpamRejectedError();
    }
    if (formData.get("consent") !== "on") {
      return { status: "error", fieldErrors: { consent: ["Please check the box to agree to be contacted before sending your message."] }, values: formValues(formData) };
    }
    const db = getDb();
    const inquiry = await createPlatformInquiry(db, formValues(formData));
    after(() => notifyPlatformInquiry(inquiry.id));
  } catch (error) {
    return errorState(error, formData);
  }
  return { status: "success", message: "Thank you. Your message has been received by the CRM platform team." };
}
