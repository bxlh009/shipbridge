import { addDays, transitDays } from "./holds";

export type TimelineEvent = {
  date: string;
  label: string;
  state: "done" | "upcoming";
};

/**
 * Deterministic demo timeline. It is not a live carrier scan.
 * Offsets are derived from the order ship date and the transit table.
 */
export function buildTimeline(
  shipDate: string,
  carrierCode: string,
  country: string,
  now = new Date(),
): TimelineEvent[] {
  const transit = transitDays(carrierCode, country);
  const planned = [
    { offset: 0, label: "Shipment information received at origin facility (Shenzhen)" },
    { offset: 1, label: "Picked up by carrier" },
    { offset: Math.max(2, Math.round(transit * 0.3)), label: "Departed origin country" },
    { offset: Math.max(3, Math.round(transit * 0.6)), label: "Arrived in destination country" },
    { offset: Math.max(4, transit - 1), label: "With local delivery partner" },
    { offset: transit, label: "Estimated delivery" },
  ];
  const seen = new Set<number>();
  const today = now.toISOString().slice(0, 10);
  const events: TimelineEvent[] = [];
  for (const item of planned) {
    if (seen.has(item.offset)) continue;
    seen.add(item.offset);
    const date = addDays(shipDate, item.offset);
    events.push({ date, label: item.label, state: date <= today ? "done" : "upcoming" });
  }
  return events;
}
