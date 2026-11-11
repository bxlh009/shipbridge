import { summarizeHolds } from "../holds";
import { scorePair } from "../matcher";
import { SELLER_PROTECTION_WARNING, type GridRow, type HoldStats, type Order } from "../types";
import { paypal, trackOrder } from "./gateway";
import { coerceMockState } from "./mock-state";

const AUTO_CONFIDENCE = 70;

export type SyncResult = {
  rows: GridRow[];
  orders: Order[] | null;
  stats: HoldStats | null;
};

export async function syncRows(rows: GridRow[], clientOrders?: Order[] | null): Promise<SyncResult> {
  const mock = paypal.mode() === "mock";
  let state = mock ? coerceMockState(clientOrders && clientOrders.length ? { orders: clientOrders } : undefined) : null;
  const liveOrders = state ? null : await paypal.listOrders();
  const results: GridRow[] = [];
  const anySelected = rows.some((row) => row.selected);

  for (const row of rows) {
    const orders = state ? state.orders : liveOrders || [];
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
      const tracked = await trackOrder(
        {
          orderId: order.id,
          captureId: order.captureId,
          trackingNumber: row.trackingNumber,
          carrier: row.paypalCarrier || row.carrier,
          carrierNameOther: row.carrierNameOther,
        },
        state,
      );
      if (tracked.state) state = tracked.state;
      const written = tracked.result;
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

  const orders = state ? state.orders : null;
  return { rows: results, orders, stats: orders ? summarizeHolds(orders) : null };
}
