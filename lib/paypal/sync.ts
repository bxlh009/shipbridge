import { summarizeHolds } from "../holds";
import { scorePair } from "../matcher";
import { SELLER_PROTECTION_WARNING, type GridRow, type HoldStats, type Order } from "../types";
import { paypal, trackOrder } from "./gateway";
import { coerceMockState } from "./mock-state";

const AUTO_CONFIDENCE = 70;

export type CarrierResult = {
  invoiceId: string;
  orderId: string;
  trackingNumber: string;
  requested: string;
  used: string;
  fallback: boolean;
  via: string;
  rejection?: string;
  error?: string;
};

export type SyncResult = {
  rows: GridRow[];
  orders: Order[] | null;
  stats: HoldStats | null;
  carrierResults: CarrierResult[];
};

export async function syncRows(rows: GridRow[], clientOrders?: Order[] | null): Promise<SyncResult> {
  const mock = paypal.mode() === "mock";
  let state = mock ? coerceMockState(clientOrders && clientOrders.length ? { orders: clientOrders } : undefined) : null;
  const liveOrders = state ? null : await paypal.listOrders();
  const results: GridRow[] = [];
  const carrierResults: CarrierResult[] = [];
  const anySelected = rows.some((row) => row.selected);

  for (const row of rows) {
    const orders = state ? state.orders : liveOrders || [];
    let order: Order | null | undefined = orders.find((item) => item.id === row.matchedOrderId);
    if (!order && !mock && row.matchedOrderId) {
      order = await paypal.getOrder(row.matchedOrderId);
      if (order && liveOrders && !liveOrders.some((item) => item.id === order?.id)) liveOrders.push(order);
    }
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
      const requestedCarrier = written.carrierRequested || row.paypalCarrier || row.carrier;
      const used = written.carrierUsed || requestedCarrier;
      const carrierNote = written.carrierFallback ? `${requestedCarrier} rejected, used OTHER` : used;
      carrierResults.push({
        invoiceId: order.invoiceId,
        orderId: order.id,
        trackingNumber: row.trackingNumber,
        requested: requestedCarrier,
        used,
        fallback: written.carrierFallback === true,
        via: written.via,
        rejection: written.rejection,
        error: written.ok ? undefined : written.error,
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
          syncMessage: `verified in PayPal (${carrierNote})`,
        });
      } else {
        results.push({
          ...row,
          addressRisk,
          syncStatus: "unverified",
          syncMessage: `Wrote via ${written.via} (${carrierNote}), but read-back did not contain ${row.trackingNumber}`,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Sync failed";
      results.push({ ...row, addressRisk, syncStatus: "failed", syncMessage: message });
    }
  }

  const orders = state ? state.orders : null;
  return { rows: results, orders, stats: orders ? summarizeHolds(orders) : null, carrierResults };
}
