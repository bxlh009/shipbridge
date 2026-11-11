import { paypalMode } from "../lib/paypal/mode";
import { captureSandboxOrder } from "../lib/paypal/rest";

async function main() {
  const ids = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
  if (!ids.length) {
    console.error("Usage: npx tsx scripts/capture.ts <orderId...>");
    process.exit(1);
  }
  if (paypalMode() === "mock") {
    console.error("Capture talks to PayPal. Set PAYPAL_MODE=sandbox and provide PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET.");
    process.exit(1);
  }
  for (const id of ids) {
    const result = (await captureSandboxOrder(id)) as { id?: string; status?: string };
    console.log(`captured ${id} status=${result.status || "ok"}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
