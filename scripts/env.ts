import { config } from "dotenv";
import { openDatabase } from "@/db";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

/** `direct` = prefer DIRECT_URL (a session-mode / direct connection), used for migrations. */
export function openFromEnv(opts: { direct?: boolean } = {}) {
  const url = (opts.direct && process.env.DIRECT_URL) || process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set. Copy .env.example to .env.local first.");
    process.exit(1);
  }
  return { url, handle: openDatabase(url) };
}

export function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
