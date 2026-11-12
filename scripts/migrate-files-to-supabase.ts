/**
 * Copies document files stored in the database into the PRIVATE Supabase Storage bucket.
 *   npm run files:migrate             # dry run (default): reports what would be copied
 *   npm run files:migrate -- --apply  # copy, verify, then switch each document to the bucket
 *   npm run files:migrate -- --apply --limit 100
 *
 * Safety:
 * - Each file is uploaded, downloaded back and checked against the document's SHA-256
 *   BEFORE its row is switched to `storage_provider = 'supabase'`. Any mismatch is skipped.
 * - Database blobs are NEVER deleted — remove them later, by hand, once backups are confirmed.
 * - Safe to re-run: files already in the bucket with a matching hash are just switched over.
 * - Prints counts only (no file names, client names or storage keys).
 */
import { createHash } from "node:crypto";
import { and, asc, eq, gt } from "drizzle-orm";
import { documents } from "@/db/schema";
import { databaseStorage, supabaseConfig, supabaseStorage } from "@/lib/storage";
import { argValue, openFromEnv } from "./env";

const apply = process.argv.includes("--apply");
const limit = Number(argValue("limit") ?? "0") || Infinity;
const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

if (!supabaseConfig().isConfigured) {
  console.error("Supabase Storage is not configured (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.local). Nothing to do.");
  process.exit(1);
}

const { handle } = openFromEnv();
const db = handle.db;
const from = databaseStorage(db);
const to = supabaseStorage();
const counts = { examined: 0, copied: 0, alreadyInBucket: 0, missingBlob: 0, hashMismatch: 0, failed: 0 };

try {
  console.log(apply ? "Copying files to the private bucket…" : "Dry run — no changes. Pass --apply to copy.");
  let cursor = "00000000-0000-0000-0000-000000000000";
  outer: for (;;) {
    const batch = await db
      .select({ id: documents.id, storageKey: documents.storageKey, sha256: documents.sha256, contentType: documents.contentType })
      .from(documents)
      .where(and(eq(documents.storageProvider, "database"), gt(documents.id, cursor)))
      .orderBy(asc(documents.id))
      .limit(100);
    if (!batch.length) break;
    for (const doc of batch) {
      cursor = doc.id;
      if (counts.examined >= limit) break outer;
      counts.examined++;
      try {
        const data = await from.get(doc.storageKey);
        if (!data) {
          counts.missingBlob++;
          continue;
        }
        if (sha256(data) !== doc.sha256) {
          counts.hashMismatch++;
          continue;
        }
        if (!apply) {
          counts.copied++;
          continue;
        }
        const existing = await to.get(doc.storageKey);
        if (existing) {
          if (sha256(existing) !== doc.sha256) {
            counts.hashMismatch++;
            continue;
          }
          counts.alreadyInBucket++;
        } else {
          await to.put(doc.storageKey, data, doc.contentType);
          const check = await to.get(doc.storageKey);
          if (!check || sha256(check) !== doc.sha256) {
            counts.hashMismatch++;
            continue;
          }
          counts.copied++;
        }
        // Switch only rows still on the database (another run may have done it already).
        await db.update(documents).set({ storageProvider: "supabase" }).where(and(eq(documents.id, doc.id), eq(documents.storageProvider, "database")));
      } catch {
        counts.failed++;
      }
    }
  }
  console.log(`examined:              ${counts.examined}`);
  console.log(`${apply ? "copied + verified:    " : "would copy:           "} ${counts.copied}`);
  if (apply) console.log(`already in bucket:     ${counts.alreadyInBucket}`);
  console.log(`missing database blob: ${counts.missingBlob}`);
  console.log(`hash mismatch (kept):  ${counts.hashMismatch}`);
  console.log(`failed (kept):         ${counts.failed}`);
  console.log("Database blobs were not deleted.");
  if (counts.failed || counts.hashMismatch || counts.missingBlob) process.exitCode = 2;
} finally {
  await handle.close();
}
