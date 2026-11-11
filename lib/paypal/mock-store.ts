import { freshOrders } from "./catalog";
import type { Order, TrackingRecord } from "../types";

type Store = { orders: Order[] };

const globalStore = globalThis as unknown as { __shipbridge?: Store };

function store(): Store {
  if (!globalStore.__shipbridge) globalStore.__shipbridge = { orders: freshOrders() };
  return globalStore.__shipbridge;
}

export function listMockOrders(): Order[] {
  return structuredClone(store().orders);
}

export function resetMockOrders(): Order[] {
  globalStore.__shipbridge = { orders: freshOrders() };
  return listMockOrders();
}

export function getMockOrder(id: string): Order | null {
  const found = store().orders.find((order) => order.id === id || order.invoiceId === id || order.captureId === id);
  return found ? structuredClone(found) : null;
}

export function writeMockTracking(orderId: string, tracking: TrackingRecord): Order | null {
  const order = store().orders.find((item) => item.id === orderId || item.captureId === orderId);
  if (!order) return null;
  const existing = order.tracking.find((item) => item.trackingNumber === tracking.trackingNumber);
  if (existing) {
    existing.carrier = tracking.carrier;
    existing.carrierNameOther = tracking.carrierNameOther;
    existing.status = tracking.status;
    existing.verified = tracking.verified;
    existing.via = tracking.via;
  } else {
    order.tracking.push({ ...tracking });
  }
  return structuredClone(order);
}
