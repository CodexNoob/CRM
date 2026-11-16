import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db";
import { firmProfile, users } from "@/db/schema";
import { actorFromUser, type Actor } from "@/lib/auth/actor";
import { hashPassword } from "@/lib/auth/crypto";
import { AppError, ValidationError } from "@/lib/errors";
import { parseInput, passwordSchema } from "@/lib/validation";
import { recordAudit } from "./audit";
import { trialEndsAt } from "./firm-billing";
import { createFirm } from "./firms";

/**
 * Self-service sign-up: creates a new firm (on a free trial) and its first admin.
 * Anti-abuse: a hidden honeypot, a minimum fill time and per-IP limits (in the action).
 */

export class SignupRejectedError extends AppError {
  constructor() {
    super("We couldn’t create your account. Please try again in a few minutes.");
  }
}

export const SIGNUP_MIN_FILL_MS = 3000;

const signupSchema = z.object({
  firmName: z.string({ error: "Firm name is required." }).trim().min(2, "Firm name is required.").max(120, "Use 120 characters or fewer."),
  name: z.string({ error: "Your name is required." }).trim().min(1, "Your name is required.").max(200),
  email: z.email("Enter a valid email address.").max(254).transform((s) => s.toLowerCase()),
  password: passwordSchema,
  confirmPassword: z.string({ error: "Confirm your password." }).min(1, "Confirm your password."),
  terms: z.preprocess((v) => v === true || v === "on", z.literal(true, { error: "Please accept the terms to continue." })),
});

export async function signUpFirm(db: Db, input: Record<string, unknown>, now = new Date()): Promise<Actor> {
  // Bot checks first, with a generic error.
  if (typeof input.website === "string" && input.website.trim() !== "") throw new SignupRejectedError();
  const started = Number(input.startedAt);
  if (!Number.isFinite(started) || now.getTime() - started < SIGNUP_MIN_FILL_MS || now.getTime() - started > 24 * 3600_000) throw new SignupRejectedError();

  const data = parseInput(signupSchema, input);
  if (data.password !== data.confirmPassword) throw new ValidationError({ confirmPassword: ["Passwords do not match."] });
  const passwordHash = await hashPassword(data.password);

  return db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const [taken] = await t.select({ one: sql<number>`1` }).from(users).where(sql`lower(${users.email}) = ${data.email}`).limit(1);
    if (taken) throw new ValidationError({ email: ["An account with this email already exists. Sign in instead."] });

    const firm = await createFirm(t, { name: data.firmName, status: "trial", trialEndsAt: trialEndsAt(now) });
    const [user] = await t.insert(users).values({ firmId: firm.id, email: data.email, name: data.name, role: "admin", passwordHash }).returning();
    // Seed a private organization profile with the chosen firm name and admin contact.
    await t.insert(firmProfile).values({ firmId: firm.id, name: data.firmName, email: data.email, updatedById: user!.id });
    await recordAudit(t, { firmId: firm.id, actorUserId: user!.id, action: "firm.signup", entityType: "firm", entityId: firm.id });
    return actorFromUser(user!);
  });
}
