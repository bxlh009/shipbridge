import fs from "fs";
import path from "path";
import { mapCarrier } from "../carriers";
import type { Order, TrackingRecord } from "../types";
import { CATALOG } from "./catalog";
import { paypalApiBase } from "./mode";

type TokenCache = { token: string; expiresAt: number };
const globalToken = globalThis as unknown as { __sbToken?: TokenCache };

const SANDBOX_FILE = path.join(process.cwd(), "data", "sandbox-orders.json");

export type TrackingWrite = {
  orderId: string;
  captureId: string;
  trackingNumber: string;
  carrier: string;
  carrierNameOther?: string;
};

function basicAuth(): string {
  const id = process.env.PAYPAL_CLIENT_ID || "";
  const secret = process.env.PAYPAL_CLIENT_SECRET || "";
  return Buffer.from(`${id}:${secret}`).toString("base64");
}

export async function getAccessToken(): Promise<string> {
  const cached = globalToken.__sbToken;
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const response = await fetch(`${paypalApiBase()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth()}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });
  const body = (await response.json()) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!response.ok || !body.access_token) {
    throw new Error(body.error_description || `PayPal OAuth failed (${response.status})`);
  }
  globalToken.__sbToken = {
    token: body.access_token,
    expiresAt: Date.now() + (body.expires_in || 300) * 1000,
  };
  return body.access_token;
}

export async function paypalFetch(pathname: string, init: RequestInit = {}): Promise<Response> {
  const token = await getAccessToken();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (!headers.has("Content-Type") && init.body) headers.set("Content-Type", "application/json");
  return fetch(`${paypalApiBase()}${pathname}`, { ...init, headers, cache: "no-store" });
}

export function readSandboxOrderIds(): string[] {
  try {
    const raw = fs.readFileSync(SANDBOX_FILE, "utf8");
    const parsed = JSON.parse(raw) as { orderIds?: string[] };
    return parsed.orderIds || [];
  } catch {
    return [];
  }
}

export function rememberSandboxOrderId(orderId: string) {
  const orderIds = Array.from(new Set([...readSandboxOrderIds(), orderId]));
  fs.mkdirSync(path.dirname(SANDBOX_FILE), { recursive: true });
  fs.writeFileSync(SANDBOX_FILE, JSON.stringify({ orderIds }, null, 2));
}

type PaypalOrder = {
  id?: string;
  status?: string;
  create_time?: string;
  purchase_units?: Array<{
    invoice_id?: string;
    description?: string;
    custom_id?: string;
    amount?: { currency_code?: string; value?: string };
    items?: Array<{ name?: string; quantity?: string }>;
    payments?: { captures?: Array<{ id?: string; status?: string }> };
    shipping?: {
      name?: { full_name?: string };
      address?: {
        address_line_1?: string;
        admin_area_2?: string;
        admin_area_1?: string;
        postal_code?: string;
        country_code?: string;
      };
    };
  }>;
};

const overlay = globalThis as unknown as { __sbTrack?: Record<string, TrackingRecord[]> };

function overlayFor(orderId: string): TrackingRecord[] {
  return overlay.__sbTrack?.[orderId] || [];
}

export function rememberLiveTracking(orderId: string, tracking: TrackingRecord) {
  if (!overlay.__sbTrack) overlay.__sbTrack = {};
  const list = overlay.__sbTrack[orderId] || [];
  const index = list.findIndex((item) => item.trackingNumber === tracking.trackingNumber);
  if (index >= 0) list[index] = tracking;
  else list.push(tracking);
  overlay.__sbTrack[orderId] = list;
}

export function mapPaypalOrder(raw: PaypalOrder): Order | null {
  if (!raw.id) return null;
  const unit = raw.purchase_units?.[0];
  const address = unit?.shipping?.address;
  const capture = unit?.payments?.captures?.[0];
  const known = CATALOG.find((item) => item.invoiceId === unit?.invoice_id || item.id === unit?.custom_id);
  const paidAt = (raw.create_time || known?.paidAt || new Date().toISOString()).slice(0, 10);
  const merged = [...(known?.tracking || []), ...overlayFor(raw.id)];
  const tracking = merged.filter(
    (item, index, list) => list.findIndex((other) => other.trackingNumber === item.trackingNumber) === index,
  );
  return {
    id: raw.id,
    invoiceId: unit?.invoice_id || known?.invoiceId || "",
    captureId: capture?.id || "",
    status: raw.status || "CREATED",
    buyerName: unit?.shipping?.name?.full_name || known?.buyerName || "",
    email: known?.email || "",
    item: unit?.items?.[0]?.name || unit?.description || known?.item || "",
    qty: Number(unit?.items?.[0]?.quantity || known?.qty || 1),
    amount: unit?.amount?.value || known?.amount || "0.00",
    currency: unit?.amount?.currency_code || "USD",
    paidAt,
    shipDate: known?.shipDate || paidAt,
    addressLine1: address?.address_line_1 || "",
    city: address?.admin_area_2 || "",
    adminArea1: address?.admin_area_1 || "",
    postalCode: address?.postal_code || "",
    country: address?.country_code || "",
    plannedCarrier: known?.plannedCarrier || "YUNEXPRESS",
    tracking,
  };
}

export async function fetchPaypalOrder(orderId: string): Promise<Order | null> {
  const response = await paypalFetch(`/v2/checkout/orders/${encodeURIComponent(orderId)}`);
  if (response.status === 404) return null;
  const body = (await response.json()) as PaypalOrder;
  if (!response.ok) return null;
  return mapPaypalOrder(body);
}

export async function listPaypalOrders(): Promise<Order[]> {
  const ids = readSandboxOrderIds();
  const orders: Order[] = [];
  for (const id of ids) {
    try {
      const order = await fetchPaypalOrder(id);
      if (order) orders.push(order);
    } catch {
      /* skip a single bad id */
    }
  }
  return orders;
}

export function containsTracking(payload: unknown, trackingNumber: string): boolean {
  if (!payload) return false;
  return JSON.stringify(payload).includes(trackingNumber);
}

export async function readBackPaypalTracking(orderId: string, captureId: string, trackingNumber: string): Promise<boolean> {
  const orderResponse = await paypalFetch(`/v2/checkout/orders/${encodeURIComponent(orderId)}`);
  if (orderResponse.ok && containsTracking(await orderResponse.json(), trackingNumber)) return true;
  if (captureId) {
    const trackerId = `${captureId}-${trackingNumber}`;
    const trackerResponse = await paypalFetch(`/v1/shipping/trackers/${encodeURIComponent(trackerId)}`);
    if (trackerResponse.ok && containsTracking(await trackerResponse.json(), trackingNumber)) return true;
    const listResponse = await paypalFetch(`/v1/shipping/trackers?transaction_id=${encodeURIComponent(captureId)}`);
    if (listResponse.ok && containsTracking(await listResponse.json(), trackingNumber)) return true;
  }
  return false;
}

export async function addPaypalTracking(input: TrackingWrite): Promise<{ ok: boolean; via: string; error?: string }> {
  const known = new Set(["YUNEXPRESS", "FOUR_PX_EXPRESS", "YANWEN", "CN_CHINA_POST_EMS", "DHL", "UPS", "FEDEX", "USPS", "OTHER"]);
  const mapping = mapCarrier(input.carrier, input.carrierNameOther);
  const resolvedCarrier = known.has(input.carrier) ? input.carrier : mapping.carrier;
  const carrierNameOther = resolvedCarrier === "OTHER" ? input.carrierNameOther || mapping.carrierNameOther || "Unknown carrier" : undefined;

  const v2Body: Record<string, unknown> = {
    capture_id: input.captureId,
    tracking_number: input.trackingNumber,
    carrier: resolvedCarrier,
    notify_payer: false,
  };
  if (carrierNameOther) v2Body.carrier_name_other = carrierNameOther;

  const v2 = await paypalFetch(`/v2/checkout/orders/${encodeURIComponent(input.orderId)}/track`, {
    method: "POST",
    body: JSON.stringify(v2Body),
  });
  if (v2.ok) return { ok: true, via: "orders_v2" };

  const v2Error = await safeError(v2);
  const tracker: Record<string, unknown> = {
    transaction_id: input.captureId,
    tracking_number: input.trackingNumber,
    status: "SHIPPED",
    carrier: resolvedCarrier,
  };
  if (carrierNameOther) tracker.carrier_name_other = carrierNameOther;
  const v1 = await paypalFetch("/v1/shipping/trackers-batch", {
    method: "POST",
    body: JSON.stringify({ trackers: [tracker] }),
  });
  if (v1.ok) return { ok: true, via: "trackers_batch" };
  const v1Error = await safeError(v1);
  return { ok: false, via: "trackers_batch", error: `Orders v2 track failed (${v2Error}). Trackers batch failed (${v1Error}).` };
}

async function safeError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string; name?: string };
    return `${response.status} ${body.name || ""} ${body.message || ""}`.trim();
  } catch {
    return String(response.status);
  }
}

export async function createSandboxOrder(template: Order): Promise<{ id: string; approveUrl: string }> {
  const value = template.amount;
  const unit = (Number(template.amount) / template.qty).toFixed(2);
  const body = {
    intent: "CAPTURE",
    purchase_units: [
      {
        invoice_id: template.invoiceId,
        custom_id: template.id,
        description: template.item,
        amount: {
          currency_code: template.currency,
          value,
          breakdown: { item_total: { currency_code: template.currency, value } },
        },
        items: [
          {
            name: template.item,
            quantity: String(template.qty),
            unit_amount: { currency_code: template.currency, value: unit },
            category: "PHYSICAL_GOODS",
          },
        ],
        shipping: {
          name: { full_name: template.buyerName },
          address: {
            address_line_1: template.addressLine1,
            admin_area_2: template.city,
            admin_area_1: template.adminArea1,
            postal_code: template.postalCode,
            country_code: template.country,
          },
        },
      },
    ],
  };
  const response = await paypalFetch("/v2/checkout/orders", { method: "POST", body: JSON.stringify(body) });
  const payload = (await response.json()) as { id?: string; message?: string; links?: { href: string; rel: string }[] };
  if (!response.ok || !payload.id) {
    throw new Error(payload.message || `Create order failed (${response.status})`);
  }
  rememberSandboxOrderId(payload.id);
  const approve = payload.links?.find((link) => link.rel === "approve")?.href;
  const host = paypalApiBase().includes("sandbox") ? "https://www.sandbox.paypal.com" : "https://www.paypal.com";
  return { id: payload.id, approveUrl: approve || `${host}/checkoutnow?token=${payload.id}` };
}

export async function captureSandboxOrder(orderId: string): Promise<unknown> {
  const response = await paypalFetch(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
    method: "POST",
    body: "{}",
  });
  const payload = await response.json();
  if (!response.ok) {
    const message = (payload as { message?: string }).message || `Capture failed (${response.status})`;
    throw new Error(message);
  }
  return payload;
}
