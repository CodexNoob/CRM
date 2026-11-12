import { createHash, randomBytes } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";

/**
 * Password hashing uses argon2id (the @node-rs/argon2 default) with the OWASP
 * recommended minimum parameters: 19 MiB memory, 2 iterations, parallelism 1.
 */
const ARGON2_OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;
/** Burns the same work as a real verification so unknown emails are not revealed by timing. */
export async function verifyAgainstDummy(password: string): Promise<void> {
  dummyHash ??= hashPassword("dummy-password-for-timing-equalisation");
  await verifyPassword(await dummyHash, password);
}

/** 256-bit random token, URL safe. Given to the user; never stored. */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/** What is stored in the database in place of a token. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
