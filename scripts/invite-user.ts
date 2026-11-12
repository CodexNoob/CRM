/**
 * Creates a staff user (or re-issues their invitation) and prints a one-time
 * link for them to set their own password. No password ever passes through
 * the command line.
 *
 *   npm run user:invite -- --email jane@firm.example --name "Jane Doe" --role admin
 */
import type { StaffRole } from "@/lib/auth/actor";
import { STAFF_ROLES } from "@/lib/auth/actor";
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
  const { token } = await createStaffInvitation(handle.db, { email, name, role }, null);
  console.log(`Invitation for ${email} (${role}). Single use, expires in 72 hours:`);
  console.log(`${appUrl()}/setup-password?token=${encodeURIComponent(token)}`);
} finally {
  await handle.close();
}
