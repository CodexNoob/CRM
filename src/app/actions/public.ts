"use server";

import { headers } from "next/headers";
import { after } from "next/server";
import { notifyNewInquiry } from "@/services/notifications";
import { getDb } from "@/db";
import { errorState, formValues, type ActionState } from "@/lib/action-state";
import { SpamRejectedError, submitWebsiteInquiry } from "@/services/leads";

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
    const lead = await submitWebsiteInquiry(getDb(), formValues(formData));
    // Send the staff alert after the response, so the visitor never waits on (or sees) email problems.
    after(() => notifyNewInquiry(lead));
  } catch (error) {
    return errorState(error, formData);
  }
  return { status: "success", message: "Thank you. We’ve received your message and will contact you within one business day." };
}
