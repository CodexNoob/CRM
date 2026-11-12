/**
 * Checks that the PayPal credentials in .env.local work (signs in only; creates nothing).
 *   npm run paypal:test
 * Prints no secrets.
 */
import "./env";
import { checkConnection, paypalConfig } from "@/integrations/paypal";

const cfg = paypalConfig();
if (!cfg.isConfigured) {
  console.error("Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in .env.local first.");
  process.exit(1);
}
try {
  await checkConnection();
  console.log(`PayPal ${cfg.environment} connection OK (currency ${cfg.currency}).`);
} catch (error) {
  console.error(`PayPal connection failed: ${(error as Error).message}`);
  process.exitCode = 1;
}
