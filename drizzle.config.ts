import { defineConfig } from "drizzle-kit";

// Used only to generate SQL migrations from src/db/schema.ts (`npm run db:generate`).
// Migrations are applied by `npm run db:migrate`, which supports both PGlite and PostgreSQL.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
});
