import { scorePair } from "../matcher";
import { SELLER_PROTECTION_WARNING, type GridRow } from "../types";
import { paypal } from "./gateway";

const AUTO_CONFIDENCE = 70;

export async function syncRows(rows: GridRow[]): Promise<GridRow[]> {
  const orders = await paypal.listOrders();
  const anySelected = rows.some((row) => row.selected);
  const results: GridRow[] = [];

  for (const row of rows) {
    const order = orders.find((item) => item.id === row.matchedOrderId);
    if (!row.matchedOrderId || !order) {
      results.push({ ...row, syncStatus: row.trackingNumber ? "skipped" : "idle", syncMessage: row.matchedOrderId ? "Order not found" : "No matched order" });
      continue;
    }
    const scored = scorePair(row, order);
    const addressRisk = scored.addressRisk;
    const explicit = Boolean(anySelected && row.selected);
    if (anySelected && !row.selected) {
      results.push({ ...row, addressRisk, addressWarning: addressRisk ? SELLER_PROTECTION_WARNING : "" });
      continue;
    }
    if (!explicit && addressRisk) {
      results.push({
        ...row,
        addressRisk: true,
        addressWarning: SELLER_PROTECTION_WARNING,
        syncStatus: "skipped",
        syncMessage: "Skipped Seller Protection risk. Check the row to sync anyway.",
      });
      continue;
    }
    if (!explicit && scored.confidence < AUTO_CONFIDENCE) {
      results.push({
        ...row,
        addressRisk,
        syncStatus: "skipped",
        syncMessage: `Confidence ${scored.confidence} is below ${AUTO_CONFIDENCE}. Select the row to override.`,
      });
      continue;
    }

    try {
      const written = await paypal.addTracking({
        orderId: order.id,
        captureId: order.captureId,
        trackingNumber: row.trackingNumber,
        carrier: row.paypalCarrier || row.carrier,
        carrierNameOther: row.carrierNameOther,
      });
      if (!written.ok) {
        results.push({ ...row, addressRisk, syncStatus: "failed", syncMessage: written.error || "PayPal rejected the tracker" });
        continue;
      }
      if (written.verified) {
        results.push({
          ...row,
          addressRisk,
          addressWarning: addressRisk ? SELLER_PROTECTION_WARNING : "",
          syncStatus: "verified",
          syncMessage: "verified in PayPal",
        });
      } else {
        results.push({
          ...row,
          addressRisk,
          syncStatus: "unverified",
          syncMessage: `Wrote via ${written.via}, but read-back did not contain ${row.trackingNumber}`,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Sync failed";
      results.push({ ...row, addressRisk, syncStatus: "failed", syncMessage: message });
    }
  }
  return results;
}
