import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { documentBlobs } from "@/db/schema";

/**
 * File storage boundary. The pilot stores bytes in the (encrypted, backed-up)
 * database; a private object store (Supabase Storage / S3) can replace this
 * without changing callers. Never expose storage keys to browsers.
 */
export interface FileStorage {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer | null>;
}

export function databaseStorage(db: Db): FileStorage {
  return {
    async put(key, data) {
      await db.insert(documentBlobs).values({ storageKey: key, data });
    },
    async get(key) {
      const [row] = await db.select({ data: documentBlobs.data }).from(documentBlobs).where(eq(documentBlobs.storageKey, key));
      return row ? row.data : null;
    },
  };
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
