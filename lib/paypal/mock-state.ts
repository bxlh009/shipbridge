import { freshOrders } from "./catalog";
import type { Order, TrackingRecord } from "../types";

/**
 * Mock PayPal state is per request. Callers pass the orders they already
 * have (the browser keeps them in localStorage) and receive the next copy.
 * Nothing here is stored on globalThis, so two serverless instances stay
 * in agreement as long as the client sends its current orders.
 */
export type MockState = { orders: Order[] };

export type MockTrackInput = {
  orderId: string;
  captureId?: string;
  trackingNumber: string;
  carrier: string;
  carrierNameOther?: string;
};

export type MockTrackResult = {
  ok: boolean;
  via: string;
  error?: string;
  verified: boolean;
};

export function seedMockState(): MockState {
  return { orders: freshOrders() };
}

function asTracking(value: unknown): TrackingRecord | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<TrackingRecord>;
  if (typeof item.trackingNumber !== "string" || !item.trackingNumber.trim()) return null;
  return {
    trackingNumber: item.trackingNumber,
    carrier: typeof item.carrier === "string" && item.carrier ? item.carrier : "OTHER",
    carrierNameOther: typeof item.carrierNameOther === "string" ? item.carrierNameOther : undefined,
    status: typeof item.status === "string" && item.status ? item.status : "SHIPPED",
    verified: item.verified === true,
    via: typeof item.via === "string" ? item.via : undefined,
  };
}

function asOrder(value: unknown): Order | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<Order>;
  if (typeof item.id !== "string" || !item.id) return null;
  if (typeof item.captureId !== "string" || !item.captureId) return null;
  const tracking = Array.isArray(item.tracking) ? item.tracking.map(asTracking).filter((row): row is TrackingRecord => Boolean(row)) : [];
  return {
    id: item.id,
    invoiceId: typeof item.invoiceId === "string" ? item.invoiceId : "",
    captureId: item.captureId,
    status: typeof item.status === "string" && item.status ? item.status : "COMPLETED",
    buyerName: typeof item.buyerName === "string" ? item.buyerName : "",
    email: typeof item.email === "string" ? item.email : "",
    item: typeof item.item === "string" ? item.item : "",
    qty: Number(item.qty) || 1,
    amount: typeof item.amount === "string" ? item.amount : String(item.amount ?? "0"),
    currency: typeof item.currency === "string" && item.currency ? item.currency : "USD",
    paidAt: typeof item.paidAt === "string" ? item.paidAt : "",
    shipDate: typeof item.shipDate === "string" ? item.shipDate : "",
    addressLine1: typeof item.addressLine1 === "string" ? item.addressLine1 : "",
    city: typeof item.city === "string" ? item.city : "",
    adminArea1: typeof item.adminArea1 === "string" ? item.adminArea1 : "",
    postalCode: typeof item.postalCode === "string" ? item.postalCode : "",
    country: typeof item.country === "string" ? item.country : "",
    plannedCarrier: typeof item.plannedCarrier === "string" && item.plannedCarrier ? item.plannedCarrier : "YUNEXPRESS",
    tracking,
  };
}

export function coerceMockState(input?: { orders?: unknown } | null): MockState {
  const list = input && Array.isArray(input.orders) ? input.orders : null;
  if (!list || !list.length) return seedMockState();
  const orders = list.map(asOrder).filter((order): order is Order => Boolean(order));
  if (!orders.length) return seedMockState();
  return { orders };
}

export function findMockOrder(state: MockState, id: string): Order | null {
  if (!id) return null;
  return state.orders.find((order) => order.id === id || order.invoiceId === id || order.captureId === id) ?? null;
}

export function withMockTracking(state: MockState, orderId: string, tracking: TrackingRecord): MockState {
  return {
    orders: state.orders.map((order) => {
      if (order.id !== orderId && order.captureId !== orderId) return order;
      const trackingList = order.tracking.map((item) => ({ ...item }));
      const index = trackingList.findIndex((item) => item.trackingNumber === tracking.trackingNumber);
      if (index >= 0) trackingList[index] = { ...trackingList[index], ...tracking };
      else trackingList.push({ ...tracking });
      return { ...order, tracking: trackingList };
    }),
  };
}

/** True only when this state already contains that tracking number on the order. */
export function mockTrackingPresent(state: MockState, orderId: string, trackingNumber: string): boolean {
  if (!orderId || !trackingNumber) return false;
  const order = findMockOrder(state, orderId);
  if (!order) return false;
  return order.tracking.some((item) => item.trackingNumber === trackingNumber);
}

/**
 * Write one tracker onto a copy of `state`, then read it back.
 * `verified` is the read-back result, not a constant.
 */
export function applyMockTrack(state: MockState, input: MockTrackInput): { state: MockState; result: MockTrackResult } {
  const order = findMockOrder(state, input.orderId);
  if (!order) {
    return { state, result: { ok: false, via: "mock", error: `Unknown order ${input.orderId}`, verified: false } };
  }
  const captureId = input.captureId || order.captureId;
  if (!captureId) {
    return { state, result: { ok: false, via: "mock", error: "Order has no capture id", verified: false } };
  }
  const record: TrackingRecord = {
    trackingNumber: input.trackingNumber,
    carrier: input.carrier,
    carrierNameOther: input.carrierNameOther,
    status: "SHIPPED",
    verified: false,
    via: "orders_v2",
  };
  let next = withMockTracking(state, order.id, record);
  if (!mockTrackingPresent(next, order.id, input.trackingNumber)) {
    return { state: next, result: { ok: true, via: "orders_v2", verified: false } };
  }
  next = withMockTracking(next, order.id, { ...record, verified: true });
  const verified = mockTrackingPresent(next, order.id, input.trackingNumber);
  return { state: next, result: { ok: true, via: "orders_v2", verified } };
}
