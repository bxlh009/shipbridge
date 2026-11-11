import type { HoldStats, Order } from "./types";

/**
 * Typical door-to-door transit days for a China cross-border line.
 * These are demo estimates, not live carrier SLAs.
 */
const TRANSIT: Record<string, Record<string, number>> = {
  YUNEXPRESS: { US: 10, GB: 12, DE: 12, AU: 15, CA: 12 },
  FOUR_PX_EXPRESS: { US: 9, GB: 11, DE: 12, AU: 14, CA: 11 },
  YANWEN: { US: 12, GB: 14, DE: 13, AU: 16, CA: 13 },
  DHL: { US: 5, GB: 5, DE: 5, AU: 6, CA: 5 },
  UPS: { US: 6, GB: 6, DE: 6, AU: 7, CA: 6 },
  FEDEX: { US: 5, GB: 5, DE: 5, AU: 6, CA: 5 },
  USPS: { US: 8, GB: 10, DE: 10, AU: 12, CA: 9 },
  CN_CHINA_POST_EMS: { US: 15, GB: 16, DE: 16, AU: 18, CA: 16 },
};

export const HOLD_DAYS = 21;

export function transitDays(carrierCode: string, country: string): number {
  const row = TRANSIT[carrierCode] || { US: 12, GB: 13, DE: 13, AU: 16, CA: 13 };
  return row[country] ?? 13;
}

export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function daysBetween(laterIso: string, earlierIso: string): number {
  const later = new Date(`${laterIso.slice(0, 10)}T00:00:00Z`).getTime();
  const earlier = new Date(`${earlierIso.slice(0, 10)}T00:00:00Z`).getTime();
  return Math.round((later - earlier) / 86_400_000);
}

export type HoldInsight = {
  onHold: boolean;
  daysEarlier: number;
  naturalRelease: string;
  earlyRelease: string;
  transitDays: number;
  carrier: string;
};

export function holdInsight(order: Order, now = new Date()): HoldInsight {
  const verified = order.tracking.find((item) => item.verified);
  const carrier = verified?.carrier || order.plannedCarrier || "YUNEXPRESS";
  const transit = transitDays(carrier, order.country);
  const naturalRelease = addDays(order.paidAt, HOLD_DAYS);
  const earlyRelease = addDays(order.shipDate, transit + 1);
  const daysEarlier = Math.max(0, daysBetween(naturalRelease, earlyRelease));
  const release = verified ? earlyRelease : naturalRelease;
  const today = now.toISOString().slice(0, 10);
  return {
    onHold: today < release,
    daysEarlier,
    naturalRelease,
    earlyRelease,
    transitDays: transit,
    carrier,
  };
}

export function summarizeHolds(orders: Order[], now = new Date()): HoldStats {
  let onHoldCount = 0;
  let onHoldAmount = 0;
  let days = 0;
  let syncedCount = 0;
  for (const order of orders) {
    const insight = holdInsight(order, now);
    if (insight.onHold) {
      onHoldCount += 1;
      onHoldAmount += Number(order.amount) || 0;
    }
    days += insight.daysEarlier;
    if (order.tracking.some((item) => item.verified)) syncedCount += 1;
  }
  const currency = orders[0]?.currency || "USD";
  return {
    totalOrders: orders.length,
    onHoldCount,
    onHoldAmount: Math.round(onHoldAmount * 100) / 100,
    currency,
    syncedCount,
    estimatedDaysReleasedEarlier: orders.length ? Math.round((days / orders.length) * 10) / 10 : 0,
    simulated: true,
  };
}
