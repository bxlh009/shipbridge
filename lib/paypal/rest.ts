import fs from "fs";
import path from "path";
import { canonicalCarrierName, mapCarrier } from "../carriers";
import type { Order, TrackingRecord } from "../types";
import { CATALOG } from "./catalog";
import { paypalApiBase } from "./mode";
import { redact } from "./redact";

type TokenCache = { token: string; expiresAt: number };
const globalToken = globalThis as unknown as { __sbToken?: TokenCache };

export const SANDBOX_FILE = path.join(process.cwd(), ".data", "sandbox-orders.json");

export type SandboxAddress = {
  line1: string;
  city: string;
  adminArea1: string;
  postalCode: string;
  country: string;
};

export type SandboxOrderRecord = {
  sampleRef: string;
  invoiceId: string;
  orderId: string;
  captureId: string;
  status: string;
  buyer: string;
  address: SandboxAddress;
  approveUrl?: string;
};

export type SandboxRegistry = {
  createdAt: string;
  updatedAt: string;
  mode: string;
  orders: SandboxOrderRecord[];
  /** Bumps when a PayPal-Request-Id must change after a failed attempt. */
  attempt: Record<string, number>;
};

export type TrackingWrite = {
  orderId: string;
  captureId: string;
  trackingNumber: string;
  carrier: string;
  carrierNameOther?: string;
};

export type TrackingWriteResult = {
  ok: boolean;
  via: string;
  error?: string;
  carrierRequested: string;
  carrierUsed: string;
  carrierFallback: boolean;
  rejection?: string;
};

const KNOWN = new Set(["YUNEXPRESS", "FOUR_PX_EXPRESS", "YANWEN", "CN_CHINA_POST_EMS", "DHL", "UPS", "FEDEX", "USPS", "OTHER"]);

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
    throw new Error(redact(body.error_description || `PayPal OAuth failed (${response.status})`));
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
  headers.set("Accept", "application/json");
  if (!headers.has("Content-Type") && init.body) headers.set("Content-Type", "application/json");
  return fetch(`${paypalApiBase()}${pathname}`, { ...init, headers, cache: "no-store" });
}

function emptyRegistry(): SandboxRegistry {
  const now = new Date().toISOString();
  return { createdAt: now, updatedAt: now, mode: "sandbox", orders: [], attempt: {} };
}

export function readSandboxRegistry(): SandboxRegistry {
  try {
    const raw = fs.readFileSync(SANDBOX_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<SandboxRegistry> & { orderIds?: string[] };
    if (Array.isArray(parsed.orders)) {
      return {
        createdAt: parsed.createdAt || new Date().toISOString(),
        updatedAt: parsed.updatedAt || new Date().toISOString(),
        mode: parsed.mode || "sandbox",
        orders: parsed.orders,
        attempt: parsed.attempt || {},
      };
    }
    if (Array.isArray(parsed.orderIds)) {
      return {
        ...emptyRegistry(),
        orders: parsed.orderIds.map((orderId) => ({
          sampleRef: "",
          invoiceId: "",
          orderId,
          captureId: "",
          status: "",
          buyer: "",
          address: { line1: "", city: "", adminArea1: "", postalCode: "", country: "" },
        })),
      };
    }
  } catch {
    /* missing or unreadable registry */
  }
  return emptyRegistry();
}

export function writeSandboxRegistry(registry: SandboxRegistry) {
  fs.mkdirSync(path.dirname(SANDBOX_FILE), { recursive: true });
  registry.updatedAt = new Date().toISOString();
  fs.writeFileSync(SANDBOX_FILE, JSON.stringify(registry, null, 2));
  fs.chmodSync(SANDBOX_FILE, 0o600);
}

export function readSandboxOrderIds(): string[] {
  return readSandboxRegistry().orders.map((order) => order.orderId).filter(Boolean);
}

export function upsertSandboxRecord(record: SandboxOrderRecord) {
  const registry = readSandboxRegistry();
  const index = registry.orders.findIndex((order) => order.invoiceId === record.invoiceId || order.orderId === record.orderId);
  if (index >= 0) registry.orders[index] = { ...registry.orders[index], ...record };
  else registry.orders.push(record);
  writeSandboxRegistry(registry);
}

export function bumpSandboxAttempt(key: string): number {
  const registry = readSandboxRegistry();
  const current = registry.attempt[key] && registry.attempt[key] > 0 ? registry.attempt[key] : 1;
  const next = current + 1;
  registry.attempt[key] = next;
  writeSandboxRegistry(registry);
  return next;
}

export function sandboxAttempt(key: string): number {
  const value = readSandboxRegistry().attempt[key];
  return value && value > 0 ? value : 1;
}

type PaypalTracker = {
  id?: string;
  status?: string;
  tracking_number?: string;
  carrier?: string;
  carrier_name_other?: string;
};

type PaypalOrder = {
  id?: string;
  status?: string;
  create_time?: string;
  message?: string;
  links?: { href: string; rel: string }[];
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
      trackers?: PaypalTracker[];
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

function trackersFromPaypal(raw: PaypalOrder, captureId: string): TrackingRecord[] {
  const trackers = raw.purchase_units?.[0]?.shipping?.trackers || [];
  const records: TrackingRecord[] = [];
  for (const tracker of trackers) {
    let trackingNumber = tracker.tracking_number || "";
    if (!trackingNumber && tracker.id && captureId && tracker.id.startsWith(`${captureId}-`)) {
      trackingNumber = tracker.id.slice(captureId.length + 1);
    }
    if (!trackingNumber) continue;
    records.push({
      trackingNumber,
      carrier: tracker.carrier || "OTHER",
      carrierNameOther: tracker.carrier_name_other,
      status: tracker.status || "SHIPPED",
      verified: true,
      via: "orders_v2",
    });
  }
  return records;
}

export function mapPaypalOrder(raw: PaypalOrder): Order | null {
  if (!raw.id) return null;
  const unit = raw.purchase_units?.[0];
  const address = unit?.shipping?.address;
  const capture = unit?.payments?.captures?.find((item) => item.status === "COMPLETED") || unit?.payments?.captures?.[0];
  const known = CATALOG.find((item) => item.invoiceId === unit?.invoice_id || item.invoiceId === unit?.custom_id || item.id === unit?.custom_id);
  const paidAt = (raw.create_time || known?.paidAt || new Date().toISOString()).slice(0, 10);
  const captureId = capture?.id || "";
  const merged = [...trackersFromPaypal(raw, captureId), ...(known?.tracking || []), ...overlayFor(raw.id)];
  const tracking = merged.filter((item, index, list) => list.findIndex((other) => other.trackingNumber === item.trackingNumber) === index);
  return {
    id: raw.id,
    invoiceId: unit?.invoice_id || known?.invoiceId || "",
    captureId,
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

export function formatPaypalError(status: number, payload: unknown): string {
  const body = (payload || {}) as {
    name?: string;
    message?: string;
    debug_id?: string;
    details?: Array<{ field?: string; issue?: string; description?: string }>;
    error_description?: string;
  };
  const details = Array.isArray(body.details)
    ? body.details
        .map((detail) => [detail.field, detail.issue, detail.description].filter(Boolean).join(" "))
        .filter(Boolean)
        .join("; ")
    : "";
  return redact(`${status} ${body.name || ""} ${body.message || body.error_description || ""} ${details} ${body.debug_id ? `debug_id=${body.debug_id}` : ""}`.replace(/\s+/g, " ").trim());
}

export function isCarrierRejection(status: number, payload: unknown): boolean {
  if (status < 400 || status >= 500) return false;
  const body = (payload || {}) as { name?: string; message?: string; details?: Array<{ field?: string; issue?: string; description?: string }> };
  const details = Array.isArray(body.details) ? body.details : [];
  for (const detail of details) {
    const blob = `${detail.field || ""} ${detail.issue || ""} ${detail.description || ""}`;
    if (/carrier/i.test(blob)) return true;
  }
  const top = `${body.name || ""} ${body.message || ""}`.toLowerCase();
  return top.includes("carrier") && /invalid|unsupported|not support|unknown/.test(top);
}

export function isAlreadyTracked(payload: unknown): boolean {
  const body = (payload || {}) as { name?: string; message?: string; details?: Array<{ issue?: string; description?: string }> };
  const parts = [body.name || "", body.message || ""];
  for (const detail of body.details || []) parts.push(detail.issue || "", detail.description || "");
  const blob = parts.join(" ").toUpperCase();
  if (/ALREADY_ADDED|ALREADY_EXISTS|DUPLICATE_TRACK|TRACKING_INFO_ALREADY|TRACKER_ALREADY/.test(blob)) return true;
  return blob.includes("ALREADY") && blob.includes("TRACK");
}

type JsonResult = { ok: boolean; status: number; payload: PaypalOrder & Record<string, unknown>; error: string };

async function paypalJson(pathname: string, init: RequestInit = {}): Promise<JsonResult> {
  const response = await paypalFetch(pathname, init);
  const text = await response.text();
  let payload: JsonResult["payload"] = {};
  if (text) {
    try {
      payload = JSON.parse(text) as JsonResult["payload"];
    } catch {
      payload = { message: text.slice(0, 300) };
    }
  }
  return {
    ok: response.ok,
    status: response.status,
    payload,
    error: response.ok ? "" : formatPaypalError(response.status, payload),
  };
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchPaypalOrder(orderId: string): Promise<Order | null> {
  let last: JsonResult | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await paypalJson(`/v2/checkout/orders/${encodeURIComponent(orderId)}`);
    if (result.status === 404) return null;
    if (result.ok) return mapPaypalOrder(result.payload);
    last = result;
    if (result.status !== 429 && result.status < 500) return null;
    await wait(400 * (attempt + 1));
  }
  if (last && !last.ok) return null;
  return null;
}

export async function fetchPaypalOrderPayload(orderId: string): Promise<JsonResult> {
  return paypalJson(`/v2/checkout/orders/${encodeURIComponent(orderId)}`);
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
  if (!payload || !trackingNumber) return false;
  return JSON.stringify(payload).includes(trackingNumber);
}

export async function readBackPaypalTracking(orderId: string, captureId: string, trackingNumber: string): Promise<boolean> {
  const orderResult = await paypalJson(`/v2/checkout/orders/${encodeURIComponent(orderId)}`);
  if (orderResult.ok && containsTracking(orderResult.payload, trackingNumber)) return true;
  if (captureId) {
    const trackerId = `${captureId}-${trackingNumber}`;
    const trackerResult = await paypalJson(`/v1/shipping/trackers/${encodeURIComponent(trackerId)}`);
    if (trackerResult.ok && containsTracking(trackerResult.payload, trackingNumber)) return true;
    const listResult = await paypalJson(`/v1/shipping/trackers?transaction_id=${encodeURIComponent(captureId)}`);
    if (listResult.ok && containsTracking(listResult.payload, trackingNumber)) return true;
  }
  return false;
}

function resolveTrackCarrier(input: TrackingWrite): { carrier: string; carrierNameOther?: string } {
  const mapping = mapCarrier(input.carrier, input.carrierNameOther);
  const carrier = KNOWN.has(input.carrier) ? input.carrier : mapping.carrier;
  const carrierNameOther = carrier === "OTHER" ? input.carrierNameOther || mapping.carrierNameOther || canonicalCarrierName(input.carrier, input.carrierNameOther) : undefined;
  return { carrier, carrierNameOther };
}

function otherCarrier(input: TrackingWrite): { carrier: "OTHER"; carrierNameOther: string } {
  return { carrier: "OTHER", carrierNameOther: canonicalCarrierName(input.carrier, input.carrierNameOther).slice(0, 64) };
}

async function postTrack(orderId: string, body: Record<string, unknown>, requestId: string): Promise<JsonResult> {
  return paypalJson(`/v2/checkout/orders/${encodeURIComponent(orderId)}/track`, {
    method: "POST",
    headers: { "PayPal-Request-Id": requestId },
    body: JSON.stringify(body),
  });
}

async function postTrackerBatch(body: Record<string, unknown>, requestId: string): Promise<JsonResult> {
  return paypalJson("/v1/shipping/trackers-batch", {
    method: "POST",
    headers: { "PayPal-Request-Id": requestId },
    body: JSON.stringify(body),
  });
}

function trackBody(input: TrackingWrite, carrier: string, carrierNameOther?: string): Record<string, unknown> {
  const body: Record<string, unknown> = {
    capture_id: input.captureId,
    tracking_number: input.trackingNumber,
    carrier,
    notify_payer: false,
  };
  if (carrier === "OTHER" && carrierNameOther) body.carrier_name_other = carrierNameOther;
  return body;
}

function batchBody(input: TrackingWrite, carrier: string, carrierNameOther?: string): Record<string, unknown> {
  const tracker: Record<string, unknown> = {
    transaction_id: input.captureId,
    tracking_number: input.trackingNumber,
    status: "SHIPPED",
    carrier,
  };
  if (carrier === "OTHER" && carrierNameOther) tracker.carrier_name_other = carrierNameOther;
  return { trackers: [tracker] };
}

export async function addPaypalTracking(input: TrackingWrite): Promise<TrackingWriteResult> {
  const resolved = resolveTrackCarrier(input);
  const fallback = otherCarrier(input);
  let carrierUsed = resolved.carrier;
  let carrierFallback = false;
  let rejection = "";

  const v2 = await postTrack(input.orderId, trackBody(input, resolved.carrier, resolved.carrierNameOther), `sb-track-${input.orderId}-${input.trackingNumber}-${resolved.carrier}`.slice(0, 100));
  let v2Final = v2;
  if (!v2.ok && !isAlreadyTracked(v2.payload) && resolved.carrier !== "OTHER" && isCarrierRejection(v2.status, v2.payload)) {
    carrierFallback = true;
    carrierUsed = "OTHER";
    rejection = v2.error;
    v2Final = await postTrack(input.orderId, trackBody(input, fallback.carrier, fallback.carrierNameOther), `sb-track-${input.orderId}-${input.trackingNumber}-OTHER`.slice(0, 100));
  }
  if (v2Final.ok || isAlreadyTracked(v2Final.payload)) {
    return { ok: true, via: "orders_v2", carrierRequested: resolved.carrier, carrierUsed, carrierFallback, rejection: rejection || undefined };
  }

  const v1 = await postTrackerBatch(batchBody(input, carrierUsed, carrierUsed === "OTHER" ? fallback.carrierNameOther : resolved.carrierNameOther), `sb-batch-${input.orderId}-${input.trackingNumber}-${carrierUsed}`.slice(0, 100));
  let v1Final = v1;
  if (!v1.ok && !isAlreadyTracked(v1.payload) && carrierUsed !== "OTHER" && isCarrierRejection(v1.status, v1.payload)) {
    carrierFallback = true;
    rejection = rejection || v1.error;
    carrierUsed = "OTHER";
    v1Final = await postTrackerBatch(batchBody(input, "OTHER", fallback.carrierNameOther), `sb-batch-${input.orderId}-${input.trackingNumber}-OTHER`.slice(0, 100));
  }
  if (v1Final.ok || isAlreadyTracked(v1Final.payload)) {
    return { ok: true, via: "trackers_batch", carrierRequested: resolved.carrier, carrierUsed, carrierFallback, rejection: rejection || undefined };
  }
  return {
    ok: false,
    via: "trackers_batch",
    error: `Orders v2 track failed (${v2Final.error}). Trackers batch failed (${v1Final.error}).`,
    carrierRequested: resolved.carrier,
    carrierUsed,
    carrierFallback,
    rejection: rejection || undefined,
  };
}

export type CreatedOrder = {
  id: string;
  status: string;
  captureId: string;
  approveUrl: string;
  payload: PaypalOrder;
};

function approveLink(payload: PaypalOrder, orderId: string): string {
  const link = payload.links?.find((item) => item.rel === "payer-action" || item.rel === "approve");
  if (link?.href) return link.href;
  const host = paypalApiBase().includes("sandbox") ? "https://www.sandbox.paypal.com" : "https://www.paypal.com";
  return orderId ? `${host}/checkoutnow?token=${orderId}` : "";
}

function captureIdOf(payload: PaypalOrder): string {
  const captures = payload.purchase_units?.[0]?.payments?.captures || [];
  return captures.find((item) => item.status === "COMPLETED")?.id || captures[0]?.id || "";
}

function orderResult(result: JsonResult): CreatedOrder {
  const id = result.payload.id || "";
  return {
    id,
    status: result.payload.status || "",
    captureId: captureIdOf(result.payload),
    approveUrl: approveLink(result.payload, id),
    payload: result.payload,
  };
}

export function purchaseUnitBody(template: Order) {
  const currency = template.currency || "USD";
  const totalCents = Math.round(Number(template.amount) * 100);
  const qty = template.qty || 1;
  const unitCents = Math.round(totalCents / qty);
  const exact = unitCents * qty === totalCents;
  const value = (totalCents / 100).toFixed(2);
  const unit = exact ? (unitCents / 100).toFixed(2) : value;
  const quantity = exact ? String(qty) : "1";
  return {
    invoice_id: template.invoiceId,
    custom_id: template.invoiceId,
    description: template.item,
    amount: {
      currency_code: currency,
      value,
      breakdown: { item_total: { currency_code: currency, value } },
    },
    items: [
      {
        name: template.item,
        quantity,
        unit_amount: { currency_code: currency, value: unit },
        category: "PHYSICAL_GOODS",
      },
    ],
    shipping: {
      type: "SHIPPING",
      name: { full_name: template.buyerName },
      address: {
        address_line_1: template.addressLine1,
        admin_area_2: template.city,
        admin_area_1: template.adminArea1,
        postal_code: template.postalCode,
        country_code: template.country,
      },
    },
  };
}

export const US_CARD_BILLING = {
  address_line_1: "1 Market Street",
  admin_area_2: "San Jose",
  admin_area_1: "CA",
  postal_code: "95113",
  country_code: "US",
};

export function cardPaymentSource(template: Order, cardNumber: string, billing: "us" | "shipping") {
  const shipping = purchaseUnitBody(template).shipping.address;
  return {
    card: {
      number: cardNumber,
      expiry: "2030-12",
      security_code: "123",
      name: template.buyerName,
      billing_address: billing === "us" ? US_CARD_BILLING : shipping,
    },
  };
}

async function postOrder(body: unknown, requestId: string): Promise<JsonResult> {
  return paypalJson("/v2/checkout/orders", {
    method: "POST",
    headers: { "PayPal-Request-Id": requestId, Prefer: "return=representation" },
    body: JSON.stringify(body),
  });
}

export async function createSandboxOrder(template: Order, requestId?: string): Promise<CreatedOrder & { error?: string; httpStatus: number }> {
  const result = await postOrder({ intent: "CAPTURE", purchase_units: [purchaseUnitBody(template)] }, requestId || `sb-wallet-${template.invoiceId}-g${sandboxAttempt(template.invoiceId)}`.slice(0, 100));
  if (!result.ok || !result.payload.id) {
    throw new Error(result.error || `Create order failed (${result.status})`);
  }
  return { ...orderResult(result), httpStatus: result.status };
}

export async function createCardOrder(template: Order, cardNumber: string, billing: "us" | "shipping", requestId: string): Promise<JsonResult & { order: CreatedOrder }> {
  const result = await postOrder(
    {
      intent: "CAPTURE",
      purchase_units: [purchaseUnitBody(template)],
      payment_source: cardPaymentSource(template, cardNumber, billing),
    },
    requestId,
  );
  return { ...result, order: orderResult(result) };
}

export async function confirmCard(orderId: string, template: Order, cardNumber: string, billing: "us" | "shipping", requestId: string): Promise<JsonResult & { order: CreatedOrder }> {
  const result = await paypalJson(`/v2/checkout/orders/${encodeURIComponent(orderId)}/confirm-payment-source`, {
    method: "POST",
    headers: { "PayPal-Request-Id": requestId, Prefer: "return=representation" },
    body: JSON.stringify({ payment_source: cardPaymentSource(template, cardNumber, billing) }),
  });
  return { ...result, order: orderResult(result.payload.id ? result : { ...result, payload: { ...result.payload, id: orderId } }) };
}

export async function captureSandboxOrder(orderId: string, requestId?: string): Promise<JsonResult & { order: CreatedOrder }> {
  const result = await paypalJson(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
    method: "POST",
    headers: { "PayPal-Request-Id": requestId || `sb-cap-${orderId}`.slice(0, 100), Prefer: "return=representation" },
    body: "{}",
  });
  return { ...result, order: orderResult(result.payload.id ? result : { ...result, payload: { ...result.payload, id: orderId } }) };
}
