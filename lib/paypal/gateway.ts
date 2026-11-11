import { mapCarrier } from "../carriers";
import type { Order, TrackingRecord } from "../types";
import {
  addPaypalTracking,
  fetchPaypalOrder,
  listPaypalOrders,
  readBackPaypalTracking,
  rememberLiveTracking,
  type TrackingWrite,
} from "./rest";
import { getMockOrder, listMockOrders, writeMockTracking } from "./mock-store";
import { paypalMode, type PaypalMode } from "./mode";

export type AddTrackingResult = { ok: boolean; via: string; error?: string; verified: boolean };

async function addAndRead(input: TrackingWrite, mode: PaypalMode): Promise<AddTrackingResult> {
  if (mode === "mock") {
    const order = getMockOrder(input.orderId);
    if (!order) return { ok: false, via: "mock", error: `Unknown order ${input.orderId}`, verified: false };
    if (!order.captureId) return { ok: false, via: "mock", error: "Order has no capture id", verified: false };
    const record: TrackingRecord = {
      trackingNumber: input.trackingNumber,
      carrier: input.carrier,
      carrierNameOther: input.carrierNameOther,
      status: "SHIPPED",
      verified: false,
      via: "orders_v2",
    };
    writeMockTracking(order.id, record);
    const readBack = getMockOrder(order.id);
    const verified = JSON.stringify(readBack).includes(input.trackingNumber);
    if (verified) writeMockTracking(order.id, { ...record, verified: true });
    return { ok: true, via: "orders_v2", verified };
  }

  if (!input.captureId) {
    return { ok: false, via: "orders_v2", error: "Order is not captured yet. Approve and capture it in the sandbox first.", verified: false };
  }
  const written = await addPaypalTracking(input);
  if (!written.ok) return { ...written, verified: false };
  const verified = await readBackPaypalTracking(input.orderId, input.captureId, input.trackingNumber);
  const record: TrackingRecord = {
    trackingNumber: input.trackingNumber,
    carrier: input.carrier,
    carrierNameOther: input.carrierNameOther,
    status: "SHIPPED",
    verified,
    via: written.via,
  };
  if (verified) rememberLiveTracking(input.orderId, record);
  return { ok: true, via: written.via, verified };
}

export const paypal = {
  mode(): PaypalMode {
    return paypalMode();
  },
  async listOrders(): Promise<Order[]> {
    return paypalMode() === "mock" ? listMockOrders() : listPaypalOrders();
  },
  async getOrder(id: string): Promise<Order | null> {
    return paypalMode() === "mock" ? getMockOrder(id) : fetchPaypalOrder(id);
  },
  async addTracking(input: {
    orderId: string;
    trackingNumber: string;
    carrier: string;
    carrierNameOther?: string;
    captureId?: string;
  }): Promise<AddTrackingResult> {
    const order = await this.getOrder(input.orderId);
    const mapping = mapCarrier(input.carrier, input.carrierNameOther);
    const carrier = ["YUNEXPRESS", "FOUR_PX_EXPRESS", "YANWEN", "CN_CHINA_POST_EMS", "DHL", "UPS", "FEDEX", "USPS", "OTHER"].includes(
      input.carrier,
    )
      ? input.carrier
      : mapping.carrier;
    return addAndRead(
      {
        orderId: order?.id || input.orderId,
        captureId: input.captureId || order?.captureId || "",
        trackingNumber: input.trackingNumber,
        carrier,
        carrierNameOther: carrier === "OTHER" ? input.carrierNameOther || mapping.carrierNameOther : undefined,
      },
      paypalMode(),
    );
  },
  async readBack(orderId: string, trackingNumber: string): Promise<boolean> {
    const order = await this.getOrder(orderId);
    if (!order) return false;
    if (paypalMode() === "mock") return JSON.stringify(order).includes(trackingNumber);
    return readBackPaypalTracking(order.id, order.captureId, trackingNumber);
  },
};
