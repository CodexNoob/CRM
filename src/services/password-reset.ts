import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { passwordResetTokens, users } from "@/db/schema";
import { escapeHtml, sendEmail } from "@/integrations/email";
import { generateToken, hashPassword, hashToken } from "@/lib/auth/crypto";
import { invalidateUserSessions } from "@/lib/auth/sessions";
import { AppError, ValidationError } from "@/lib/errors";
import { parseInput, passwordSchema } from "@/lib/validation";
import { recordAudit } from "./audit";
import { z } from "zod";

export const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;
const REQUEST_COOLDOWN_MS = 60 * 1000;

const emailSchema = z.object({
  email: z.email("Enter a valid email address.").max(254).transform((value) => value.trim().toLowerCase()),
});

export class InvalidPasswordResetError extends AppError {
  constructor() {
    super("This password reset link is invalid or has expired. Request a new one.");
  }
}

function appOrigin(): string | null {
  const configured = process.env.APP_URL?.trim();
  if (!configured) return null;
  try {
    const url = new URL(configured);
    if (url.pathname !== "/" || url.search || url.hash) return null;
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Always returns normally for valid input so callers cannot discover account existence. */
export async function requestPasswordReset(db: Db, input: unknown, now = new Date()): Promise<void> {
  const { email } = parseInput(emailSchema, input);
  const [user] = await db.select({ id: users.id, name: users.name })
    .from(users)
    .where(and(sql`lower(${users.email}) = ${email}`, eq(users.isActive, true), sql`${users.passwordHash} IS NOT NULL`))
    .limit(1);
  if (!user) return;

  const [previous] = await db.select({ createdAt: passwordResetTokens.createdAt })
    .from(passwordResetTokens)
    .where(eq(passwordResetTokens.userId, user.id))
    .limit(1);
  if (previous && now.getTime() - previous.createdAt.getTime() < REQUEST_COOLDOWN_MS) return;

  const origin = appOrigin();
  if (!origin) {
    console.error("Password reset email could not be prepared", { userId: user.id, reason: "APP_URL is missing or invalid" });
    return;
  }

  const token = generateToken();
  const tokenHash = hashToken(token);
  await db.insert(passwordResetTokens).values({
    id: tokenHash,
    userId: user.id,
    expiresAt: new Date(now.getTime() + PASSWORD_RESET_TTL_MS),
    usedAt: null,
    createdAt: now,
  }).onConflictDoUpdate({
    target: passwordResetTokens.userId,
    set: {
      id: tokenHash,
      expiresAt: new Date(now.getTime() + PASSWORD_RESET_TTL_MS),
      usedAt: null,
      createdAt: now,
    },
  });

  const resetUrl = `${origin}/reset-password?token=${encodeURIComponent(token)}`;
  const safeName = escapeHtml(user.name);
  const safeUrl = escapeHtml(resetUrl);
  const result = await sendEmail({
    to: email,
    subject: "Reset your Personal CRM password",
    text: `Hello ${user.name},\n\nUse this one-time link to reset your password. It expires in 30 minutes:\n${resetUrl}\n\nIf you did not request this, you can ignore this email.`,
    html: `<p>Hello ${safeName},</p><p>Use this one-time link to reset your password. It expires in 30 minutes.</p><p><a href="${safeUrl}">Reset your password</a></p><p>If you did not request this, you can ignore this email.</p>`,
  });
  if (!result.ok) {
    await db.update(passwordResetTokens).set({ usedAt: now }).where(eq(passwordResetTokens.id, tokenHash));
    console.error("Password reset email failed", { userId: user.id, error: result.error.split(" ")[0] });
  }
}

export async function resetPassword(db: Db, input: { token: unknown; password: unknown; confirmPassword: unknown }, now = new Date()): Promise<void> {
  const token = input.token;
  if (typeof token !== "string" || token.length < 20 || token.length > 200) throw new InvalidPasswordResetError();
  const password = parseInput(passwordSchema, input.password);
  if (password !== input.confirmPassword) throw new ValidationError({ confirmPassword: ["Passwords do not match."] });

  const tokenHash = hashToken(token);
  const [row] = await db.select({ reset: passwordResetTokens, user: users })
    .from(passwordResetTokens)
    .innerJoin(users, eq(users.id, passwordResetTokens.userId))
    .where(eq(passwordResetTokens.id, tokenHash))
    .limit(1);
  if (!row || row.reset.usedAt || row.reset.expiresAt.getTime() <= now.getTime() || !row.user.isActive) {
    throw new InvalidPasswordResetError();
  }

  const passwordHash = await hashPassword(password);
  await db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const consumed = await t.update(passwordResetTokens)
      .set({ usedAt: now })
      .where(and(eq(passwordResetTokens.id, tokenHash), isNull(passwordResetTokens.usedAt)))
      .returning({ userId: passwordResetTokens.userId });
    if (!consumed.length) throw new InvalidPasswordResetError();

    await t.update(users).set({
      passwordHash,
      failedLoginCount: 0,
      lockedUntil: null,
      updatedAt: now,
    }).where(eq(users.id, row.user.id));
    await recordAudit(t, {
      firmId: row.user.firmId,
      actorUserId: row.user.id,
      action: "auth.password_reset",
      entityType: "user",
      entityId: row.user.id,
    });
  });
  await invalidateUserSessions(db, row.user.id);
}
