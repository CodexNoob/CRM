/**
 * Loads FICTIONAL demo data for local development and prints one-time
 * set-password links for each demo login. Refuses to run against anything
 * other than an embedded (pglite:) database unless --allow-postgres is given.
 */
import { sql } from "drizzle-orm";
import { users } from "@/db/schema";
import type { Actor } from "@/lib/auth/actor";
import { createClient } from "@/services/clients";
import { createEngagement, createTask } from "@/services/engagements";
import { createPortalInvitation, createStaffInvitation } from "@/services/users";
import { createFirm } from "@/services/firms";
import { appUrl, openFromEnv } from "./env";

const { url, handle } = openFromEnv();
if (!url.startsWith("pglite:") && !process.argv.includes("--allow-postgres")) {
  console.error("Refusing to seed demo data into a PostgreSQL database. Pass --allow-postgres for a disposable dev database.");
  process.exit(1);
}

const db = handle.db;
try {
  await handle.migrate();
  const [{ count }] = (await db.select({ count: sql<number>`count(*)::int` }).from(users)) as [{ count: number }];
  if (count > 0) {
    console.error("Database already has users; not seeding. Delete the .data directory to start over.");
    process.exit(1);
  }

  const links: [string, string][] = [];
  const link = (token: string) => `${appUrl()}/setup-password?token=${encodeURIComponent(token)}`;

  const firm = await createFirm(db, { name: "Demo Tax & Accounting", status: "active" });
  const adminInvite = await createStaffInvitation(db, firm.id, { email: "admin@demo.test", name: "Avery Admin", role: "admin" }, null);
  const prepInvite = await createStaffInvitation(db, firm.id, { email: "preparer@demo.test", name: "Parker Preparer", role: "preparer" }, null);
  links.push(["admin@demo.test (firm admin)", link(adminInvite.token)], ["preparer@demo.test (preparer)", link(prepInvite.token)]);

  const admin: Actor = { userId: adminInvite.userId, firmId: firm.id, role: "admin", clientId: null, name: "Avery Admin", email: "admin@demo.test" };

  const jordan = await createClient(db, admin, { type: "individual", displayName: "Jordan Sample", email: "jordan@demo.test", phone: "555-010-1000" });
  const rivera = await createClient(db, admin, { type: "household", displayName: "Rivera Household (demo)", email: "rivera@demo.test" });
  await createClient(db, admin, { type: "business", displayName: "Maple Street Bakery LLC (demo)", status: "prospect" });

  const e1 = await createEngagement(db, admin, jordan.id, {
    title: "2026 Form 1040",
    serviceType: "individual_tax",
    taxYear: 2026,
    status: "waiting_on_client",
    ownerId: prepInvite.userId,
    dueDate: "2027-04-15",
  });
  await createTask(db, admin, e1.id, { title: "Upload your 2026 W-2 forms", isClientTask: true, dueDate: "2027-02-15" });
  await createTask(db, admin, e1.id, { title: "Complete the tax organizer questionnaire", isClientTask: true });
  await createTask(db, admin, e1.id, { title: "Review prior-year return for carryovers", assigneeId: prepInvite.userId });

  const e2 = await createEngagement(db, admin, rivera.id, {
    title: "2026 joint return",
    serviceType: "individual_tax",
    taxYear: 2026,
    status: "not_started",
    ownerId: adminInvite.userId,
    dueDate: "2027-04-15",
  });
  await createTask(db, admin, e2.id, { title: "Send engagement letter", assigneeId: adminInvite.userId });

  const jordanPortal = await createPortalInvitation(db, admin, jordan.id, { name: "Jordan Sample", email: "jordan@demo.test" });
  const riveraPortal = await createPortalInvitation(db, admin, rivera.id, { name: "Sam Rivera", email: "rivera@demo.test" });
  links.push(["jordan@demo.test (client portal)", link(jordanPortal.token)], ["rivera@demo.test (client portal)", link(riveraPortal.token)]);

  console.log("Demo data loaded. Open each link to set that login's password (single use, 72 hours):\n");
  for (const [who, l] of links) console.log(`${who}\n  ${l}\n`);
} finally {
  await handle.close();
}
