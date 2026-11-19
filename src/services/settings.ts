import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db";
import { announcements, firmProfile, firms, platformInquiries, platformSettings } from "@/db/schema";
import { product } from "@/content/product";
import type { Actor } from "@/lib/auth/actor";
import { canManageTeam } from "@/lib/auth/actor";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { isUuid, parseInput } from "@/lib/validation";
import { inFirm } from "./access";
import { recordAudit } from "./audit";

export interface LogoUpload {
  data: Buffer;
  contentType: "image/png" | "image/jpeg";
}

export interface OrganizationProfile {
  name: string;
  tagline: string;
  description: string;
  websiteUrl: string;
  phone: string;
  email: string;
  addressLine1: string;
  addressLine2: string;
  addressLines: string[];
  hours: [string, string][];
  socialLinks: { label: string; url: string }[];
  timeZone: string;
  locale: string;
  currency: string;
  logoDataUrl: string | null;
  fromDatabase: boolean;
}

export interface PlatformProfile {
  name: string;
  description: string;
  websiteUrl: string;
  officialEmail: string;
  phone: string;
  addressLine1: string;
  addressLine2: string;
  salesEmail: string;
  supportEmail: string;
  supportPhone: string;
  logoDataUrl: string | null;
  fromDatabase: boolean;
}

const EMPTY_ORGANIZATION: Omit<OrganizationProfile, "name"> = {
  tagline: "",
  description: "",
  websiteUrl: "",
  phone: "",
  email: "",
  addressLine1: "",
  addressLine2: "",
  addressLines: [],
  hours: [],
  socialLinks: [],
  timeZone: "America/New_York",
  locale: "en-US",
  currency: "USD",
  logoDataUrl: null,
  fromDatabase: false,
};

const EMPTY_PLATFORM: PlatformProfile = {
  name: product.name,
  description: product.description,
  websiteUrl: "",
  officialEmail: "",
  phone: "",
  addressLine1: "",
  addressLine2: "",
  salesEmail: "",
  supportEmail: "",
  supportPhone: "",
  logoDataUrl: null,
  fromDatabase: false,
};

function dataUrl(data: Buffer | null, contentType: string | null): string | null {
  if (!data || (contentType !== "image/png" && contentType !== "image/jpeg")) return null;
  return `data:${contentType};base64,${data.toString("base64")}`;
}

/** Tenant-only business identity. It is never used by the root product website. */
export async function getOrganizationProfile(db: Db, firmId: string): Promise<OrganizationProfile> {
  const [row] = await db.select().from(firmProfile).where(eq(firmProfile.firmId, firmId)).limit(1);
  if (!row) {
    const [firm] = await db.select({ name: firms.name }).from(firms).where(eq(firms.id, firmId)).limit(1);
    if (!firm) throw new NotFoundError();
    return { ...EMPTY_ORGANIZATION, name: firm.name };
  }
  return {
    name: row.name,
    tagline: row.tagline ?? "",
    description: row.description ?? "",
    websiteUrl: row.websiteUrl ?? "",
    phone: row.phone ?? "",
    email: row.email ?? "",
    addressLine1: row.addressLine1 ?? "",
    addressLine2: row.addressLine2 ?? "",
    addressLines: [row.addressLine1, row.addressLine2].filter((line): line is string => !!line),
    hours: row.hours ?? [],
    socialLinks: row.socialLinks ?? [],
    timeZone: row.timeZone,
    locale: row.locale,
    currency: row.currency,
    logoDataUrl: dataUrl(row.logoData, row.logoContentType),
    fromDatabase: true,
  };
}

/** Public product identity, controlled only by Super Admins. Never falls back to a tenant. */
export async function getPlatformProfile(db: Db): Promise<PlatformProfile> {
  const [row] = await db.select().from(platformSettings).where(eq(platformSettings.id, "default")).limit(1);
  if (!row) return EMPTY_PLATFORM;
  return {
    name: row.name,
    description: row.description ?? product.description,
    websiteUrl: row.websiteUrl ?? "",
    officialEmail: row.officialEmail ?? "",
    phone: row.phone ?? "",
    addressLine1: row.addressLine1 ?? "",
    addressLine2: row.addressLine2 ?? "",
    salesEmail: row.salesEmail ?? "",
    supportEmail: row.supportEmail ?? "",
    supportPhone: row.supportPhone ?? "",
    logoDataUrl: dataUrl(row.logoData, row.logoContentType),
    fromDatabase: true,
  };
}

function requireAdmin(actor: Actor) {
  if (!canManageTeam(actor)) throw new ForbiddenError();
}

function requireSuperAdmin(actor: Actor) {
  if (actor.role !== "super_admin") throw new ForbiddenError();
}

const required = (label: string, max: number) =>
  z.string({ error: `${label} is required.` }).trim().min(1, `${label} is required.`).max(max, `${label} is too long.`);
const optionalText = (label: string, max: number) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().trim().max(max, `${label} is too long.`).optional());
const optionalUrl = (label: string) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().trim().url(`Enter a valid ${label} URL.`).refine((value) => /^https?:\/\//i.test(value), `Use an http or https ${label} URL.`).optional(),
  );
const optionalEmail = (label: string) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.email(`Enter a valid ${label} email address.`).max(254).optional(),
  );
const optionalPhone = (label: string) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().trim().regex(/^[0-9+().\-\s]{7,30}$/, `Enter a valid ${label} phone number.`).optional(),
  );

const organizationProfileSchema = z.object({
  name: required("Organization name", 200),
  tagline: optionalText("Tagline", 300),
  description: optionalText("Description", 2000),
  websiteUrl: optionalUrl("website"),
  phone: optionalPhone("business"),
  email: optionalEmail("business"),
  addressLine1: optionalText("Address", 200),
  addressLine2: optionalText("Address", 200),
  hours: optionalText("Hours", 1000),
  socialLinks: optionalText("Social links", 2000),
  timeZone: z.string().trim().min(1).max(100).default("America/New_York").refine((value) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: value });
      return true;
    } catch (error) {
      if (error instanceof RangeError) return false;
      throw error;
    }
  }, "Enter a valid IANA time zone, such as America/New_York."),
  locale: z.string().trim().regex(/^[a-z]{2}(?:-[A-Z]{2})?$/, "Use a locale such as en-US.").default("en-US"),
  currency: z.string().trim().regex(/^[A-Z]{3}$/, "Use a three-letter currency code such as USD.").default("USD"),
});

const platformProfileSchema = z.object({
  name: required("Platform name", 200),
  description: optionalText("Description", 2000),
  websiteUrl: optionalUrl("website"),
  officialEmail: optionalEmail("official"),
  phone: optionalPhone("business"),
  addressLine1: optionalText("Address", 200),
  addressLine2: optionalText("Address", 200),
  salesEmail: optionalEmail("sales"),
  supportEmail: optionalEmail("support"),
  supportPhone: optionalPhone("support"),
});

function parseHours(raw: string | undefined): [string, string][] {
  return (raw ?? "")
    .split(/\r?\n/)
    .map((line) => line.split("|").map((part) => part.trim()))
    .filter((parts) => parts[0])
    .slice(0, 10)
    .map((parts) => [parts[0]!.slice(0, 60), (parts[1] ?? "").slice(0, 60)] as [string, string]);
}

function parseSocialLinks(raw: string | undefined): { label: string; url: string }[] {
  const links: { label: string; url: string }[] = [];
  for (const line of (raw ?? "").split(/\r?\n/).filter((value) => value.trim())) {
    const [label, url] = line.split("|").map((part) => part.trim());
    if (!label || !url || label.length > 40 || url.length > 500) throw new ValidationError({ socialLinks: ["Enter social links as Label | https://example.com."] });
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch (error) {
      if (error instanceof TypeError) throw new ValidationError({ socialLinks: ["Enter social links as Label | https://example.com."] });
      throw error;
    }
    if (!["http:", "https:"].includes(parsed.protocol)) throw new ValidationError({ socialLinks: ["Social links must use http or https."] });
    links.push({ label, url: parsed.toString() });
    if (links.length > 10) throw new ValidationError({ socialLinks: ["You can add up to 10 social links."] });
  }
  return links;
}

export async function saveFirmProfile(db: Db, actor: Actor, input: unknown, logo?: LogoUpload | null) {
  requireAdmin(actor);
  const d = parseInput(organizationProfileSchema, input);
  const updatedAt = new Date();
  const values = {
    name: d.name,
    tagline: d.tagline ?? null,
    description: d.description ?? null,
    websiteUrl: d.websiteUrl ?? null,
    phone: d.phone ?? null,
    email: d.email ?? null,
    addressLine1: d.addressLine1 ?? null,
    addressLine2: d.addressLine2 ?? null,
    hours: parseHours(d.hours),
    socialLinks: parseSocialLinks(d.socialLinks),
    timeZone: d.timeZone,
    locale: d.locale,
    currency: d.currency,
    updatedById: actor.userId,
    updatedAt,
  };
  const logoValues = logo === undefined ? {} : { logoData: logo?.data ?? null, logoContentType: logo?.contentType ?? null };
  await db.insert(firmProfile).values({ firmId: actor.firmId, ...values, ...logoValues }).onConflictDoUpdate({
    target: firmProfile.firmId,
    set: { ...values, ...logoValues },
  });
  await db.update(firms).set({ name: d.name, updatedAt }).where(eq(firms.id, actor.firmId));
  await recordAudit(db, { firmId: actor.firmId, actorUserId: actor.userId, action: "settings.organization_profile", entityType: "settings", entityId: "firm_profile" });
}

export async function savePlatformProfile(db: Db, actor: Actor, input: unknown, logo?: LogoUpload | null) {
  requireSuperAdmin(actor);
  const d = parseInput(platformProfileSchema, input);
  const updatedAt = new Date();
  const values = {
    name: d.name,
    description: d.description ?? null,
    websiteUrl: d.websiteUrl ?? null,
    officialEmail: d.officialEmail ?? null,
    phone: d.phone ?? null,
    addressLine1: d.addressLine1 ?? null,
    addressLine2: d.addressLine2 ?? null,
    salesEmail: d.salesEmail ?? null,
    supportEmail: d.supportEmail ?? null,
    supportPhone: d.supportPhone ?? null,
    updatedById: actor.userId,
    updatedAt,
  };
  const logoValues = logo === undefined ? {} : { logoData: logo?.data ?? null, logoContentType: logo?.contentType ?? null };
  await db.insert(platformSettings).values({ id: "default", ...values, ...logoValues }).onConflictDoUpdate({
    target: platformSettings.id,
    set: { ...values, ...logoValues },
  });
  await recordAudit(db, { firmId: actor.firmId, actorUserId: actor.userId, action: "settings.platform_profile", entityType: "settings", entityId: "platform_settings" });
}

export async function createPlatformInquiry(db: Db, input: unknown) {
  const d = parseInput(z.object({
    name: required("Name", 200),
    email: z.email("Enter a valid email address.").max(254).transform((value) => value.toLowerCase()),
    phone: optionalPhone("contact"),
    topic: z.enum(["sales", "technical_support", "general"]),
    message: required("Message", 2000),
  }), input);
  const [row] = await db.insert(platformInquiries).values({
    name: d.name,
    email: d.email,
    phone: d.phone ?? null,
    topic: d.topic,
    message: d.message,
  }).returning({ id: platformInquiries.id });
  return row!;
}

export async function listPlatformInquiries(db: Db, actor: Actor) {
  requireSuperAdmin(actor);
  return db.select().from(platformInquiries).orderBy(desc(platformInquiries.createdAt)).limit(200);
}

export async function setPlatformInquiryStatus(db: Db, actor: Actor, id: string, status: "new" | "in_progress" | "resolved") {
  requireSuperAdmin(actor);
  if (status !== "new" && status !== "in_progress" && status !== "resolved") throw new ValidationError({ status: ["Choose a valid inquiry status."] });
  if (!isUuid(id)) throw new NotFoundError();
  const rows = await db.update(platformInquiries).set({ status }).where(eq(platformInquiries.id, id)).returning({ id: platformInquiries.id });
  if (!rows.length) throw new NotFoundError();
}

export async function getPortalAnnouncements(db: Db, actor: Actor, limit = 5) {
  if (actor.role !== "client") throw new ForbiddenError();
  return db
    .select({ id: announcements.id, title: announcements.title, body: announcements.body, date: announcements.publishedOn })
    .from(announcements)
    .where(and(eq(announcements.firmId, actor.firmId), eq(announcements.isPublished, true)))
    .orderBy(desc(announcements.publishedOn))
    .limit(limit);
}

export async function listAllAnnouncements(db: Db, actor: Actor) {
  requireAdmin(actor);
  return db.select().from(announcements).where(inFirm(announcements.firmId, actor)).orderBy(desc(announcements.publishedOn), desc(announcements.createdAt));
}

const announcementSchema = z.object({
  title: required("Title", 200),
  body: required("Text", 2000),
  publishedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date."),
});

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
