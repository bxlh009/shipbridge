import { canonicalCarrierName, mapCarrier } from "../carriers";
import type { Order, TrackingRecord } from "../types";
import {
  addPaypalTracking,
  fetchPaypalOrder,
  listPaypalOrders,
  readBackPaypalTracking,
  rememberLiveTracking,
  type TrackingWrite,
} from "./rest";
import { applyMockTrack, findMockOrder, mockTrackingPresent, seedMockState, type MockState } from "./mock-state";
import { paypalMode, type PaypalMode } from "./mode";

export type AddTrackingResult = {
  ok: boolean;
  via: string;
  error?: string;
  verified: boolean;
  carrierRequested?: string;
  carrierUsed?: string;
  carrierFallback?: boolean;
  rejection?: string;
};

const KNOWN = new Set(["YUNEXPRESS", "FOUR_PX_EXPRESS", "YANWEN", "CN_CHINA_POST_EMS", "DHL", "UPS", "FEDEX", "USPS", "OTHER"]);

export type TrackInput = {
  orderId: string;
  trackingNumber: string;
  carrier: string;
  carrierNameOther?: string;
  captureId?: string;
};

function resolveCarrier(input: TrackInput): { carrier: string; carrierNameOther?: string } {
  const mapping = mapCarrier(input.carrier, input.carrierNameOther);
  const carrier = KNOWN.has(input.carrier) ? input.carrier : mapping.carrier;
  return {
    carrier,
    carrierNameOther: carrier === "OTHER" ? input.carrierNameOther || mapping.carrierNameOther : undefined,
  };
}

async function addAndReadLive(input: TrackingWrite): Promise<AddTrackingResult> {
  if (!input.captureId) {
    return { ok: false, via: "orders_v2", error: "Order is not captured yet. Approve and capture it in the sandbox first.", verified: false };
  }
  const written = await addPaypalTracking(input);
  const verified = await readBackPaypalTracking(input.orderId, input.captureId, input.trackingNumber);
  const record: TrackingRecord = {
    trackingNumber: input.trackingNumber,
    carrier: written.carrierUsed || input.carrier,
    carrierNameOther: written.carrierUsed === "OTHER" ? canonicalCarrierName(input.carrier, input.carrierNameOther) : input.carrierNameOther,
    status: "SHIPPED",
    verified,
    via: written.via,
  };
  if (verified) rememberLiveTracking(input.orderId, record);
  if (!written.ok && !verified) return { ...written, verified: false };
  return {
    ok: true,
    via: written.via,
    verified,
    carrierRequested: written.carrierRequested,
    carrierUsed: written.carrierUsed,
    carrierFallback: written.carrierFallback,
    rejection: written.rejection,
  };
}

/**
 * Mock mode updates `state` and returns the next copy. Pass null to start
 * from the fixed catalog. Sandbox and live ignore `state` and call REST.
 */
export async function trackOrder(input: TrackInput, state: MockState | null): Promise<{ result: AddTrackingResult; state: MockState | null }> {
  const resolved = resolveCarrier(input);
  if (paypalMode() === "mock") {
    const base = state ?? seedMockState();
    const order = findMockOrder(base, input.orderId);
    const applied = applyMockTrack(base, {
      orderId: order?.id || input.orderId,
      captureId: input.captureId || order?.captureId || "",
      trackingNumber: input.trackingNumber,
      carrier: resolved.carrier,
      carrierNameOther: resolved.carrierNameOther,
    });
    return { result: applied.result, state: applied.state };
  }
  const order = await fetchPaypalOrder(input.orderId);
  const result = await addAndReadLive({
    orderId: order?.id || input.orderId,
    captureId: input.captureId || order?.captureId || "",
    trackingNumber: input.trackingNumber,
    carrier: resolved.carrier,
    carrierNameOther: resolved.carrierNameOther,
  });
  return { result, state: null };
}

export const paypal = {
  mode(): PaypalMode {
    return paypalMode();
  },
  async listOrders(): Promise<Order[]> {
    return paypalMode() === "mock" ? seedMockState().orders : listPaypalOrders();
  },
  async getOrder(id: string): Promise<Order | null> {
    if (paypalMode() === "mock") return findMockOrder(seedMockState(), id);
    return fetchPaypalOrder(id);
  },
  async addTracking(input: TrackInput): Promise<AddTrackingResult> {
    const tracked = await trackOrder(input, null);
    return tracked.result;
  },
  async readBack(orderId: string, trackingNumber: string, state?: MockState | null): Promise<boolean> {
    if (paypalMode() === "mock") return mockTrackingPresent(state ?? seedMockState(), orderId, trackingNumber);
    const order = await fetchPaypalOrder(orderId);
    if (!order) return false;
    return readBackPaypalTracking(order.id, order.captureId, trackingNumber);
  },
};
