import { CATALOG } from "../lib/paypal/catalog";
import { paypalMode } from "../lib/paypal/mode";
import { createSandboxOrder } from "../lib/paypal/rest";

async function main() {
  if (paypalMode() === "mock") {
    console.log("PAYPAL_MODE=mock (or credentials are missing).");
    console.log("Mock orders come from the fixed catalog. The browser keeps tracking in localStorage:");
    for (const order of CATALOG) {
      console.log(`  ${order.id}  ${order.buyerName}  ${order.postalCode} ${order.country}  ${order.invoiceId}`);
    }
    console.log("Set PAYPAL_MODE=sandbox plus PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET to create sandbox orders.");
    return;
  }

  console.log(`Creating ${CATALOG.length} sandbox orders (intent CAPTURE) at ${process.env.PAYPAL_ENV || "sandbox"}...`);
  for (const template of CATALOG) {
    const created = await createSandboxOrder(template);
    console.log(`${template.id}  PayPal ${created.id}`);
    console.log(`  approve: ${created.approveUrl}`);
  }
  console.log("");
  console.log("Capture is a second step. Log in as the sandbox personal buyer and approve each link,");
  console.log("then run: npx tsx scripts/capture.ts <orderId...>");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
