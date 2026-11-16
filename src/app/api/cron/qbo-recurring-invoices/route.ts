import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db";
import { issueScheduledInvoice } from "@/services/invoices";
import { listDueSubscriptions } from "@/services/subscriptions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(request: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!expected || expected.length < 32 || provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

export async function GET(request: NextRequest) {
  if (!process.env.CRON_SECRET || process.env.CRON_SECRET.length < 32) {
    return NextResponse.json({ error: "Recurring invoice job is not configured." }, { status: 503 });
  }
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const db = getDb();
  const due = await listDueSubscriptions(db);
  const results = await Promise.allSettled(due.map((subscription) => issueScheduledInvoice(db, subscription)));
  const failed = results.filter((result) => result.status === "rejected");
  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    if (result?.status === "rejected") {
      console.error("Recurring QuickBooks invoice failed", {
        subscriptionId: due[index]?.id,
        error: result.reason instanceof Error ? result.reason.name : "UnknownError",
      });
    }
  }
  return NextResponse.json({ processed: results.length - failed.length, failed: failed.length }, { status: failed.length ? 207 : 200 });
}
