import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db";
import { announcements, firmProfile, firms } from "@/db/schema";
import { site, announcements as defaultAnnouncements } from "@/content/site";
import type { Actor } from "@/lib/auth/actor";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { isUuid, parseInput } from "@/lib/validation";
import { inFirm } from "./access";
import { recordAudit } from "./audit";

/**
 * Firm profile + announcements, edited by admins in Settings and read by the
 * public website. Until an admin saves a profile, the defaults in
 * src/content/site.ts are used.
 */

export interface PublicFirmProfile {
  name: string;
  phone: string;
  email: string;
  addressLines: string[];
  hours: [string, string][];
  tagline: string;
  fromDatabase: boolean;
}

const DEFAULTS: PublicFirmProfile = {
  name: site.name,
  phone: site.contact.phone,
  email: site.contact.email,
  addressLines: [...site.contact.addressLines],
  hours: site.contact.hours,
  tagline: site.tagline,
  fromDatabase: false,
};

/** The public details of one firm. Falls back to the defaults until its admin saves a profile. */
export async function getPublicProfile(db: Db, firmId: string): Promise<PublicFirmProfile> {
  const [row] = await db.select().from(firmProfile).where(eq(firmProfile.firmId, firmId));
  if (!row) return DEFAULTS;
  return {
    name: row.name,
    phone: row.phone ?? "",
    email: row.email ?? "",
    addressLines: [row.addressLine1, row.addressLine2].filter((l): l is string => !!l),
    hours: row.hours ?? [],
    tagline: row.tagline ?? DEFAULTS.tagline,
    fromDatabase: true,
  };
}

export async function getPublicAnnouncements(db: Db, firmId: string, limit = 5) {
  const rows = await db
    .select({ id: announcements.id, title: announcements.title, body: announcements.body, date: announcements.publishedOn })
    .from(announcements)
    .where(and(eq(announcements.firmId, firmId), eq(announcements.isPublished, true)))
    .orderBy(desc(announcements.publishedOn))
    .limit(limit);
  return rows;
}

/** True once the firm has started managing announcements in the CRM (then defaults are not shown). */
export async function hasManagedAnnouncements(db: Db, firmId: string) {
  const [row] = await db.select({ id: announcements.id }).from(announcements).where(eq(announcements.firmId, firmId)).limit(1);
  return !!row;
}

export async function getWebsiteContent(db: Db, firmId: string) {
  const [profile, managed, list] = await Promise.all([getPublicProfile(db, firmId), hasManagedAnnouncements(db, firmId), getPublicAnnouncements(db, firmId)]);
  return {
    profile,
    announcements: managed ? list : defaultAnnouncements.map((a, i) => ({ id: `default-${i}`, title: a.title, body: a.body, date: a.date })),
  };
}

function requireAdmin(actor: Actor) {
  if (actor.role !== "admin") throw new ForbiddenError();
}

const required = (label: string, max: number) =>
  z.string({ error: `${label} is required.` }).trim().min(1, `${label} is required.`).max(max, `${label} is too long.`);
const text = (label: string, max: number) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().trim().max(max, `${label} is too long.`).optional());

const profileSchema = z.object({
  name: required("Firm name", 200),
  tagline: text("Tagline", 300),
  phone: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().trim().regex(/^[0-9+().\-\s]{7,30}$/, "Enter a valid phone number.").optional()),
  email: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.email("Enter a valid email address.").max(254).optional()),
  addressLine1: text("Address", 200),
  addressLine2: text("Address", 200),
  hours: text("Hours", 1000),
});

/** `hours` is entered one per line as "Days | Times". */
function parseHours(raw: string | undefined): [string, string][] {
  return (raw ?? "")
    .split(/\r?\n/)
    .map((l) => l.split("|").map((s) => s.trim()))
    .filter((p) => p[0])
    .slice(0, 10)
    .map((p) => [p[0]!.slice(0, 60), (p[1] ?? "").slice(0, 60)] as [string, string]);
}

export async function saveFirmProfile(db: Db, actor: Actor, input: unknown) {
  requireAdmin(actor);
  const d = parseInput(profileSchema, input);
  const values = {
    name: d.name,
    tagline: d.tagline ?? null,
    phone: d.phone ?? null,
    email: d.email ?? null,
    addressLine1: d.addressLine1 ?? null,
    addressLine2: d.addressLine2 ?? null,
    hours: parseHours(d.hours),
    updatedById: actor.userId,
    updatedAt: new Date(),
  };
  await db.insert(firmProfile).values({ firmId: actor.firmId, ...values }).onConflictDoUpdate({ target: firmProfile.firmId, set: values });
  // Keep the firm's account name in step with its public name (the page address /f/<slug> stays the same).
  await db.update(firms).set({ name: d.name, updatedAt: values.updatedAt }).where(eq(firms.id, actor.firmId));
  await recordAudit(db, { firmId: actor.firmId, actorUserId: actor.userId, action: "settings.firm_profile", entityType: "settings", entityId: "firm_profile" });
}

const announcementSchema = z.object({
  title: required("Title", 200),
  body: required("Text", 2000),
  publishedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date."),
});

export async function listAllAnnouncements(db: Db, actor: Actor) {
  requireAdmin(actor);
  return db.select().from(announcements).where(inFirm(announcements.firmId, actor)).orderBy(desc(announcements.publishedOn), desc(announcements.createdAt));
}

export async function createAnnouncement(db: Db, actor: Actor, input: unknown) {
  requireAdmin(actor);
  const d = parseInput(announcementSchema, input);
  const [row] = await db.insert(announcements).values({ ...d, firmId: actor.firmId, createdById: actor.userId }).returning();
  await recordAudit(db, { firmId: actor.firmId, actorUserId: actor.userId, action: "settings.announcement_create", entityType: "announcement", entityId: row!.id });
  return row!;
}

export async function setAnnouncementPublished(db: Db, actor: Actor, id: string, published: boolean) {
  requireAdmin(actor);
  if (!isUuid(id)) throw new NotFoundError();
  const res = await db.update(announcements).set({ isPublished: published, updatedAt: new Date() }).where(and(eq(announcements.id, id), inFirm(announcements.firmId, actor))).returning({ id: announcements.id });
  if (!res.length) throw new NotFoundError();
  await recordAudit(db, { firmId: actor.firmId, actorUserId: actor.userId, action: published ? "settings.announcement_publish" : "settings.announcement_unpublish", entityType: "announcement", entityId: id });
}
