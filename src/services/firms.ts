import { asc, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { firms, type Firm } from "@/db/schema";
import { NotFoundError } from "@/lib/errors";

/**
 * Firms (tenants). Public pages that are not yet per-firm (the current home page
 * and its inquiry form) belong to the DEFAULT firm: DEFAULT_FIRM_SLUG if set,
 * otherwise the oldest firm (firm #1, which owns the pre-multi-firm data).
 */

export async function getFirmBySlug(db: Db, slug: string): Promise<Firm> {
  const [firm] = await db.select().from(firms).where(eq(firms.slug, slug)).limit(1);
  if (!firm) throw new NotFoundError();
  return firm;
}

export async function getFirm(db: Db, firmId: string): Promise<Firm> {
  const [firm] = await db.select().from(firms).where(eq(firms.id, firmId)).limit(1);
  if (!firm) throw new NotFoundError();
  return firm;
}

/** The firm that owns the public home page. Null if no firm exists yet (before first-run setup). */
export async function getDefaultFirm(db: Db): Promise<Firm | null> {
  const slug = process.env.DEFAULT_FIRM_SLUG?.trim();
  if (slug) {
    const [bySlug] = await db.select().from(firms).where(eq(firms.slug, slug)).limit(1);
    if (bySlug) return bySlug;
  }
  const [oldest] = await db.select().from(firms).orderBy(asc(firms.createdAt)).limit(1);
  return oldest ?? null;
}

/** "Duot Tax Services, LLC" → "duot-tax-services-llc" (max 48 chars). */
export function slugify(name: string): string {
  return (
    name
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48)
      .replace(/-+$/g, "") || "firm"
  );
}

/** Creates a firm with a unique slug (appends -2, -3… on collision). */
export async function createFirm(db: Db, input: { name: string; status?: Firm["status"]; trialEndsAt?: Date | null }): Promise<Firm> {
  const base = slugify(input.name);
  for (let i = 1; i < 50; i++) {
    const slug = i === 1 ? base : `${base}-${i}`;
    const [row] = await db
      .insert(firms)
      .values({ name: input.name, slug, status: input.status ?? "trial", trialEndsAt: input.trialEndsAt ?? null })
      .onConflictDoNothing({ target: firms.slug })
      .returning();
    if (row) return row;
  }
  throw new Error("Could not allocate a unique firm slug");
}
