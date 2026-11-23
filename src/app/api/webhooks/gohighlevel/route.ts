import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db";
import { syncGoHighLevelLead } from "@/services/gohighlevel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 64 * 1024;

function authorized(request: NextRequest) {
  const expected = process.env.GOHIGHLEVEL_WEBHOOK_SECRET?.trim();
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!expected || expected.length < 32 || provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

function parseLead(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const contact = body.contact && typeof body.contact === "object" && !Array.isArray(body.contact)
    ? body.contact as Record<string, unknown>
    : body;
  const id = contact.id ?? contact.contactId ?? contact.contact_id;
  const firstName = typeof contact.firstName === "string" ? contact.firstName.trim() : typeof contact.first_name === "string" ? contact.first_name.trim() : "";
  const lastName = typeof contact.lastName === "string" ? contact.lastName.trim() : typeof contact.last_name === "string" ? contact.last_name.trim() : "";
  const fullName = typeof contact.name === "string" ? contact.name.trim() : [firstName, lastName].filter(Boolean).join(" ");
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(id) || !fullName || fullName.length > 200) return null;
  const email = typeof contact.email === "string" ? contact.email.trim().toLowerCase() : null;
  const phone = typeof (contact.phone ?? contact.phoneNumber ?? contact.phone_number) === "string"
    ? String(contact.phone ?? contact.phoneNumber ?? contact.phone_number).trim()
    : null;
  const company = typeof (contact.companyName ?? contact.company_name ?? contact.company) === "string"
    ? String(contact.companyName ?? contact.company_name ?? contact.company).trim().slice(0, 200) || null
    : null;
  const rawTags = contact.tags;
  const tags = Array.isArray(rawTags) ? rawTags.filter((tag): tag is string => typeof tag === "string").slice(0, 30) : [];
  if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return null;
  if (phone && !/^[0-9+().\-\s]{7,30}$/.test(phone)) return null;
  return { contactId: id, name: fullName, email, phone, company, source: "gohighlevel", tags };
}

export async function POST(request: NextRequest) {
  if (!process.env.GOHIGHLEVEL_WEBHOOK_SECRET || !process.env.GOHIGHLEVEL_FIRM_ID) {
    return NextResponse.json({ error: "GoHighLevel webhook is not configured." }, { status: 503 });
  }
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const length = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) return NextResponse.json({ error: "Payload too large." }, { status: 413 });
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return NextResponse.json({ error: "Expected a JSON webhook payload." }, { status: 415 });
  }
  let body: unknown;
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return NextResponse.json({ error: "Payload too large." }, { status: 413 });
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }
  const input = parseLead(body);
  if (!input) return NextResponse.json({ error: "Payload must include a valid contact ID and name, with valid email and phone when provided." }, { status: 400 });
  try {
    const result = await syncGoHighLevelLead(getDb(), process.env.GOHIGHLEVEL_FIRM_ID, input);
    return NextResponse.json({ received: true, ...result });
  } catch (error) {
    console.error("GoHighLevel lead sync failed", { error: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "Lead sync failed." }, { status: 500 });
  }
}
