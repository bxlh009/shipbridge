import { describe, expect, it } from "vitest";
import { summarizeHolds } from "@/lib/holds";
import { matchRows } from "@/lib/matcher";
import { freshOrders } from "@/lib/paypal/catalog";
import { applyMockTrack, mockTrackingPresent, seedMockState } from "@/lib/paypal/mock-state";
import { syncRows } from "@/lib/paypal/sync";
import { loadSample } from "@/lib/samples";

const NOW = new Date("2026-11-11T12:00:00Z");

describe("stateless mock sync", () => {
  it("reads a tracking number back only when that state contains it", () => {
    const seed = seedMockState();
    const first = applyMockTrack(seed, { orderId: "SB-1001", trackingNumber: "YT202611110001", carrier: "YUNEXPRESS" });
    expect(first.result).toMatchObject({ ok: true, verified: true, via: "orders_v2" });
    expect(mockTrackingPresent(first.state, "SB-1001", "YT202611110001")).toBe(true);
    expect(mockTrackingPresent(seed, "SB-1001", "YT202611110001")).toBe(false);

    const chained = applyMockTrack(first.state, { orderId: "SB-1002", trackingNumber: "YT-SECOND", carrier: "YUNEXPRESS" });
    expect(mockTrackingPresent(chained.state, "SB-1001", "YT202611110001")).toBe(true);
    expect(mockTrackingPresent(chained.state, "SB-1002", "YT-SECOND")).toBe(true);
    expect(mockTrackingPresent(seedMockState(), "SB-1002", "YT-SECOND")).toBe(false);

    const lying = {
      ...freshOrders()[0],
      tracking: [{ trackingNumber: "REAL-1", carrier: "YUNEXPRESS", status: "SHIPPED", verified: true }],
    };
    expect(mockTrackingPresent({ orders: [lying] }, "SB-1001", "REAL-1")).toBe(true);
    expect(mockTrackingPresent({ orders: [lying] }, "SB-1001", "YT202611110001")).toBe(false);

    const missing = applyMockTrack(seed, { orderId: "SB-404", trackingNumber: "NOPE", carrier: "YUNEXPRESS" });
    expect(missing.result).toMatchObject({ ok: false, verified: false });
    expect(missing.state.orders).toHaveLength(seed.orders.length);
  });

  it("returns updated orders from syncRows and forgets them on the next call", async () => {
    const catalog = freshOrders();
    const before = summarizeHolds(catalog, NOW);
    expect(before.onHoldCount).toBe(10);
    expect(before.releasingAmount).toBe(0);
    expect(before.estimatedDaysReleasedEarlier).toBe(0);

    const matched = matchRows(loadSample("all"), catalog).map((row) => ({ ...row, selected: false }));
    const synced = await syncRows(matched, catalog);
    const verified = synced.rows.filter((row) => row.syncStatus === "verified");
    expect(verified).toHaveLength(8);
    expect(synced.rows.find((row) => row.recipientName === "Anna Schmidt")?.syncStatus).toBe("skipped");
    expect(synced.orders?.find((order) => order.id === "SB-1001")?.tracking.some((item) => item.trackingNumber === "YT202611110001" && item.verified)).toBe(true);
    expect(mockTrackingPresent({ orders: synced.orders || [] }, "SB-1001", "NOT-ON-THE-ORDER")).toBe(false);

    const after = summarizeHolds(synced.orders || [], NOW);
    expect(after.onHoldCount).toBe(2);
    expect(after.syncedCount).toBe(8);
    expect(after.releasePendingCount).toBe(8);
    expect(after.releasingAmount).toBe(206.79);
    expect(after.onHoldAmount).toBe(36.5);
    expect(after.estimatedDaysReleasedEarlier).toBeGreaterThan(0);

    expect(freshOrders().every((order) => order.tracking.length === 0)).toBe(true);
    const isolated = await syncRows(
      matched.filter((row) => row.trackingNumber === "YW202611110006").map((row) => ({ ...row, selected: true })),
      freshOrders(),
    );
    expect(mockTrackingPresent({ orders: isolated.orders || [] }, "SB-1001", "YT202611110001")).toBe(false);
    expect(isolated.orders?.some((order) => order.tracking.some((item) => item.trackingNumber === "YW202611110006" && item.verified))).toBe(true);

    const kept = await syncRows(
      matched.filter((row) => row.trackingNumber === "YW202611110006").map((row) => ({ ...row, selected: true })),
      synced.orders,
    );
    expect(mockTrackingPresent({ orders: kept.orders || [] }, "SB-1001", "YT202611110001")).toBe(true);
    expect(mockTrackingPresent({ orders: kept.orders || [] }, kept.orders?.find((order) => order.tracking.some((item) => item.trackingNumber === "YW202611110006"))?.id || "", "YW202611110006")).toBe(true);
  });
});
