import { openFromEnv } from "./env";

const { handle } = openFromEnv({ direct: true });
try {
  await handle.migrate();
  console.log("Migrations applied.");
} finally {
  await handle.close();
}
