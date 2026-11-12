import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { documentBlobs } from "@/db/schema";

/**
 * File storage boundary. Files go to a PRIVATE Supabase Storage bucket when
 * SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are configured (server-side only — the key
 * must never reach a browser); otherwise to the (encrypted, backed-up) database.
 * Each document row records which provider holds its bytes, so both can coexist
 * while files are migrated. Never expose storage keys or bucket paths to browsers.
 */
export interface FileStorage {
  readonly provider: "database" | "supabase";
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  /** Short-lived download URL, or null when the provider can't sign URLs (stream through the app instead). */
  signedUrl(key: string, opts: { fileName: string; expiresInSeconds?: number }): Promise<string | null>;
}

export function databaseStorage(db: Db): FileStorage {
  return {
    provider: "database",
    async put(key, data) {
      await db.insert(documentBlobs).values({ storageKey: key, data });
    },
    async get(key) {
      const [row] = await db.select({ data: documentBlobs.data }).from(documentBlobs).where(eq(documentBlobs.storageKey, key));
      return row ? row.data : null;
    },
    async signedUrl() {
      return null;
    },
  };
}

export function supabaseConfig() {
  const url = process.env.SUPABASE_URL?.trim().replace(/\/$/, "") || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || "";
  const bucket = process.env.SUPABASE_STORAGE_BUCKET?.trim() || "client-documents";
  return { url, key, bucket, isConfigured: /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url) && key.length > 20 };
}

/** Private Supabase Storage bucket via its REST API (no SDK; server-side only). */
export function supabaseStorage(fetchImpl: typeof fetch = fetch): FileStorage {
  const cfg = supabaseConfig();
  const headers = { Authorization: `Bearer ${cfg.key}`, apikey: cfg.key };
  const objectPath = (key: string) => `${encodeURIComponent(cfg.bucket)}/${key.split("/").map(encodeURIComponent).join("/")}`;
  return {
    provider: "supabase",
    async put(key, data, contentType) {
      const res = await fetchImpl(`${cfg.url}/storage/v1/object/${objectPath(key)}`, {
        method: "POST",
        headers: { ...headers, "Content-Type": contentType, "x-upsert": "false", "Cache-Control": "no-store" },
        body: new Uint8Array(data),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) throw new Error(`Storage upload failed (${res.status})`);
    },
    async get(key) {
      const res = await fetchImpl(`${cfg.url}/storage/v1/object/authenticated/${objectPath(key)}`, { headers, signal: AbortSignal.timeout(60_000), cache: "no-store" });
      if (res.status === 404 || res.status === 400) return null;
      if (!res.ok) throw new Error(`Storage download failed (${res.status})`);
      return Buffer.from(await res.arrayBuffer());
    },
    async signedUrl(key, opts) {
      const res = await fetchImpl(`${cfg.url}/storage/v1/object/sign/${objectPath(key)}`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        // 60 s is enough to start a download and short enough to be useless if leaked.
        body: JSON.stringify({ expiresIn: Math.min(Math.max(opts.expiresInSeconds ?? 60, 10), 300) }),
        signal: AbortSignal.timeout(15_000),
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Storage signing failed (${res.status})`);
      const body = (await res.json()) as { signedURL?: string };
      if (!body.signedURL) return null;
      const sep = body.signedURL.includes("?") ? "&" : "?";
      return `${cfg.url}/storage/v1${body.signedURL}${sep}download=${encodeURIComponent(opts.fileName)}`;
    },
  };
}

/** Storage for NEW uploads: the private bucket when configured, else the database. */
export function defaultStorage(db: Db): FileStorage {
  return supabaseConfig().isConfigured ? supabaseStorage() : databaseStorage(db);
}

/** Storage that holds an EXISTING file (by the provider recorded on its document row). */
export function storageFor(db: Db, provider: string): FileStorage {
  return provider === "supabase" ? supabaseStorage() : databaseStorage(db);
}

/**
 * Malware scanning boundary. No scanner is configured yet, so files are
 * recorded as "not_scanned" and the UI says so. Plug a real scanner in here
 * (e.g. ClamAV or a cloud scanning API) and return "clean" / "infected".
 */
export interface MalwareScanner {
  scan(data: Buffer, fileName: string): Promise<"not_scanned" | "clean" | "infected">;
}

export const noScanner: MalwareScanner = {
  async scan() {
    return "not_scanned";
  },
};
