import { createHash, timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db";
import { users } from "@/db/schema";
import { actorFromUser, type Actor } from "@/lib/auth/actor";
import { site } from "@/content/site";
import { hashPassword } from "@/lib/auth/crypto";
import { AppError, ValidationError } from "@/lib/errors";
import { parseInput, passwordSchema } from "@/lib/validation";
import { recordAudit } from "./audit";
import { createFirm, getDefaultFirm } from "./firms";

/**
 * First-run setup: creates the firm's first admin from the web UI.
 * Available only while the database has NO users, and only with the setup
 * code from the server's SETUP_CODE environment variable.
 */

export const MIN_SETUP_CODE_LENGTH = 24;

export class SetupUnavailableError extends AppError {
  constructor() {
    super("Setup has already been completed. Sign in instead.");
  }
}

export async function hasAnyUsers(db: Db): Promise<boolean> {
  const rows = await db.select({ one: sql<number>`1` }).from(users).limit(1);
  return rows.length > 0;
}

export function isSetupCodeConfigured(code: string | undefined): code is string {
  return typeof code === "string" && code.length >= MIN_SETUP_CODE_LENGTH;
}

function codesMatch(given: string, expected: string): boolean {
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

const setupSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(200),
  email: z.email("Enter a valid email address.").max(254).transform((s) => s.toLowerCase()),
  password: passwordSchema,
  confirmPassword: z.string(),
  setupCode: z.string().max(500),
});

export async function createFirstAdmin(db: Db, input: unknown, expectedCode: string | undefined): Promise<Actor> {
  if (!isSetupCodeConfigured(expectedCode)) {
    throw new AppError("Setup is not enabled on this server. Ask your administrator to set SETUP_CODE.");
  }
  const data = parseInput(setupSchema, input);
  if (data.password !== data.confirmPassword) {
    throw new ValidationError({ confirmPassword: ["Passwords do not match."] });
  }
  if (!codesMatch(data.setupCode, expectedCode)) {
    throw new ValidationError({ setupCode: ["That setup code is not correct."] });
  }
  const passwordHash = await hashPassword(data.password);

  return db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    // Serializes concurrent setup attempts so only one first admin can ever be created.
    await t.execute(sql`select pg_advisory_xact_lock(724001)`);
    if (await hasAnyUsers(t)) throw new SetupUnavailableError();
    // The first admin belongs to firm #1 (created here on a brand-new database; the
    // multi-firm migration already created it if data existed). It is the operator's own
    // firm, so it starts active rather than on a trial.
    const firm = (await getDefaultFirm(t)) ?? (await createFirm(t, { name: site.name, status: "active" }));
    const [user] = await t
      .insert(users)
      .values({ firmId: firm.id, email: data.email, name: data.name, role: "admin", passwordHash })
      .returning();
    if (!user) throw new Error("Insert returned no row");
    await recordAudit(t, { firmId: firm.id, actorUserId: user.id, action: "setup.first_admin", entityType: "user", entityId: user.id });
    return actorFromUser(user);
  });
}
