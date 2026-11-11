import { CATALOG } from "../lib/paypal/catalog";
import { loadLocalEnv } from "../lib/paypal/load-env";
import { paypalMode } from "../lib/paypal/mode";
import { redact } from "../lib/paypal/redact";
import { captureSandboxOrder, fetchPaypalOrderPayload, readSandboxRegistry, upsertSandboxRecord } from "../lib/paypal/rest";

loadLocalEnv();

async function main() {
  const ids = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
  const registry = readSandboxRegistry();
  const targets = ids.length ? ids : registry.orders.filter((order) => order.orderId && !order.captureId).map((order) => order.orderId);
  if (!targets.length) {
    console.error("Usage: npx tsx scripts/capture.ts <orderId...>");
    console.error("With no ids, captures registry orders that do not have a capture id yet.");
    process.exit(1);
  }
  if (paypalMode() === "mock") {
    console.error("Capture talks to PayPal. Set PAYPAL_MODE=sandbox and provide PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET. Process env overrides .env.local.");
    process.exit(1);
  }
  for (const id of targets) {
    const captured = await captureSandboxOrder(id, `sb-cap-${id}`.slice(0, 108));
    const payload = captured.ok ? captured.payload : (await fetchPaypalOrderPayload(id)).payload;
    const captures = payload.purchase_units?.[0]?.payments?.captures || [];
    const captureId = captures.find((item) => item.status === "COMPLETED")?.id || captures[0]?.id || captured.order.captureId;
    const status = payload.status || captured.order.status || "";
    const known = registry.orders.find((order) => order.orderId === id);
    const template = CATALOG.find((order) => order.invoiceId === known?.invoiceId || order.invoiceId === payload.purchase_units?.[0]?.invoice_id);
    if (!captured.ok && status !== "COMPLETED") {
      console.log(`FAIL ${id}  ${redact(captured.error || status || "capture failed")}`);
      continue;
    }
    if (known || template) {
      upsertSandboxRecord({
        sampleRef: known?.sampleRef || template?.id || "",
        invoiceId: known?.invoiceId || template?.invoiceId || payload.purchase_units?.[0]?.invoice_id || "",
        orderId: id,
        captureId: captureId || "",
        status: status || "COMPLETED",
        buyer: known?.buyer || template?.buyerName || payload.purchase_units?.[0]?.shipping?.name?.full_name || "",
        address: known?.address || {
          line1: template?.addressLine1 || "",
          city: template?.city || "",
          adminArea1: template?.adminArea1 || "",
          postalCode: template?.postalCode || "",
          country: template?.country || "",
        },
        approveUrl: known?.approveUrl,
      });
    }
    console.log(`captured ${id} status=${status || "ok"} capture=${captureId || "none"}`);
  }
}

main().catch((error) => {
  console.error(redact(error instanceof Error ? error.message : String(error)));
  process.exit(1);
});
