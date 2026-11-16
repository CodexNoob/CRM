import { asc, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { firms, type Firm } from "@/db/schema";
import type { Actor } from "@/lib/auth/actor";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { isUuid } from "@/lib/validation";

/** Firms are private tenants; the product marketing site is platform-owned. */

/** Internal slug lookup for management tools; not used for public firm routing. */
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

export async function listPlatformFirms(db: Db, actor: Actor) {
  if (actor.role !== "super_admin") throw new ForbiddenError();
  return db.select({ id: firms.id, name: firms.name }).from(firms).orderBy(asc(firms.name)).limit(1000);
}

/** Resolves the selected tenant for platform-admin pages; other roles stay in their own firm. */
export async function resolveFirmContext(db: Db, actor: Actor, requestedFirmId?: string): Promise<Actor> {
  if (actor.role !== "super_admin") return actor;
  const firmId = requestedFirmId?.trim() || actor.firmId;
  if (!isUuid(firmId)) throw new NotFoundError();
  const firm = await getFirm(db, firmId);
  return { ...actor, firmId: firm.id };
}

/** The operator workspace used during first-run setup. Null before setup. */
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
