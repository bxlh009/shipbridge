export type ManifestRow = {
  trackingNumber: string;
  carrier: string;
  recipientName: string;
  postcode: string;
  country: string;
  city: string;
  item: string;
  qty: number;
  refNo: string;
  source?: string;
};

export type TrackingRecord = {
  trackingNumber: string;
  carrier: string;
  carrierNameOther?: string;
  status: string;
  verified: boolean;
  via?: string;
};

export type Order = {
  id: string;
  invoiceId: string;
  captureId: string;
  status: string;
  buyerName: string;
  email: string;
  item: string;
  qty: number;
  amount: string;
  currency: string;
  paidAt: string;
  shipDate: string;
  addressLine1: string;
  city: string;
  adminArea1: string;
  postalCode: string;
  country: string;
  /** PayPal carrier code used for the hold estimate before a tracker is written. */
  plannedCarrier: string;
  tracking: TrackingRecord[];
};

export type SyncStatus = "idle" | "verified" | "unverified" | "failed" | "skipped";

export type GridRow = ManifestRow & {
  id: string;
  paypalCarrier: string;
  carrierNameOther?: string;
  matchedOrderId: string | null;
  buyerName: string | null;
  confidence: number;
  reasons: string[];
  llmNote?: string;
  addressRisk: boolean;
  addressWarning: string;
  syncStatus: SyncStatus;
  syncMessage?: string;
  selected?: boolean;
};

export type HoldStats = {
  totalOrders: number;
  onHoldCount: number;
  onHoldAmount: number;
  /** Amount whose verified tracking moved it off the 21-day hold. */
  releasingAmount: number;
  /** Verified tracking, still before the estimated delivery release. */
  releasePendingCount: number;
  currency: string;
  syncedCount: number;
  estimatedDaysReleasedEarlier: number;
  simulated: true;
};

export const SELLER_PROTECTION_WARNING =
  "Seller Protection risk: ship only to PayPal address";
