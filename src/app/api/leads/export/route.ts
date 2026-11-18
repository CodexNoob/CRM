import { getDb } from "@/db";
import { getCurrentActor, getCurrentFirmAccess } from "@/lib/auth/current";
import { ForbiddenError } from "@/lib/errors";
import { parseLeadFilters, type LeadSearchParams } from "@/app/crm/leads/filters";
import { firmToday } from "@/services/dashboard";
import { exportLeadsCsv } from "@/services/leads";

/** Byte-order mark so Excel opens UTF-8 names correctly. */
const BOM = String.fromCharCode(0xfeff);

/**
 * CSV export of the leads matching the same filters as /crm/leads.
 * Requires the leads "export" permission (checked in the service). Never cached.
 */
export async function GET(request: Request) {
  const actor = await getCurrentActor();
  if (!actor || actor.role === "client") return new Response("Not found", { status: 404 });
  if ((await getCurrentFirmAccess(actor.firmId)).locked) return new Response("Subscription required", { status: 402 });

  const params: LeadSearchParams = Object.fromEntries(new URL(request.url).searchParams.entries());
  const today = firmToday();
  try {
    const csv = await exportLeadsCsv(getDb(), actor, parseLeadFilters(params, today));
    return new Response(BOM + csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="leads-${today}.csv"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof ForbiddenError) return new Response("You do not have permission to export leads.", { status: 403 });
    console.error("Lead export failed", { name: (error as Error)?.name });
    return new Response("Something went wrong", { status: 500 });
  }
}
