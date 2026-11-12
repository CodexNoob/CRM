/**
 * Creates a staff user (or re-issues their invitation) and prints a one-time
 * link for them to set their own password. No password ever passes through
 * the command line.
 *
 *   npm run user:invite -- --email jane@firm.example --name "Jane Doe" --role admin [--firm <slug>]
 * Without --firm, the user joins the default firm (DEFAULT_FIRM_SLUG, else firm #1).
 */
import type { StaffRole } from "@/lib/auth/actor";
import { STAFF_ROLES } from "@/lib/auth/actor";
import { getDefaultFirm, getFirmBySlug } from "@/services/firms";
import { createStaffInvitation } from "@/services/users";
import { appUrl, argValue, openFromEnv } from "./env";

const email = argValue("email");
const name = argValue("name");
const role = argValue("role") as StaffRole | undefined;

if (!email || !name || !role || !STAFF_ROLES.includes(role)) {
  console.error(`Usage: npm run user:invite -- --email <email> --name "<name>" --role <${STAFF_ROLES.join("|")}>`);
  process.exit(1);
}

const { handle } = openFromEnv();
try {
  const slug = argValue("firm");
  const firm = slug ? await getFirmBySlug(handle.db, slug) : await getDefaultFirm(handle.db);
  if (!firm) throw new Error("No firm exists yet. Run the first-run setup (/setup) first.");
  const { token } = await createStaffInvitation(handle.db, firm.id, { email, name, role }, null);
  console.log(`Invitation for ${email} (${role}) at ${firm.name}. Single use, expires in 72 hours:`);
  console.log(`${appUrl()}/setup-password?token=${encodeURIComponent(token)}`);
} finally {
  await handle.close();
}
