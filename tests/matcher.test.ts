import { describe, expect, it } from "vitest";
import { freshOrders } from "@/lib/paypal/catalog";
import { matchRows } from "@/lib/matcher";
import { nameSimilarity } from "@/lib/text";
import { SELLER_PROTECTION_WARNING, type ManifestRow } from "@/lib/types";

function row(partial: Partial<ManifestRow> & Pick<ManifestRow, "trackingNumber" | "recipientName">): ManifestRow {
  return {
    carrier: "YunExpress",
    postcode: "",
    country: "",
    city: "",
    item: "",
    qty: 1,
    refNo: "",
    ...partial,
  };
}

describe("matcher", () => {
  const orders = freshOrders();

  it("normalizes diacritics and token order", () => {
    expect(nameSimilarity("Lukáš Weber", "Lukas Weber")).toBe(1);
    expect(nameSimilarity("Carter Emily", "Emily Carter")).toBe(1);
    expect(nameSimilarity("Micheal Obrien", "Michael O'Brien")).toBeGreaterThan(0.8);
  });

  it("matches a name typo and flags a postcode mismatch", () => {
    const rows = matchRows(
      [
        row({
          trackingNumber: "YT-TYPO",
          recipientName: "Micheal Obrien",
          postcode: "90210",
          country: "US",
          item: "Yoga Mat",
          refNo: "",
        }),
        row({
          trackingNumber: "YT-RED",
          recipientName: "Anna Schmidt",
          postcode: "10117",
          country: "DE",
          item: "Ceramic Mug Set",
          refNo: "INV-1004",
        }),
        row({
          trackingNumber: "YT-NONE",
          recipientName: "Noah Bennett",
          postcode: "3000",
          country: "AU",
          item: "Hiking Socks",
          refNo: "INV-ORPHAN",
        }),
        row({
          trackingNumber: "YT-OK",
          recipientName: "Emily Carter",
          postcode: "10001",
          country: "美国",
          item: "Silicone Phone Case",
          refNo: "INV-1001",
        }),
      ],
      orders,
    );

    const typo = rows.find((item) => item.trackingNumber === "YT-TYPO");
    expect(typo?.matchedOrderId).toBe("SB-1003");
    expect(typo?.buyerName).toBe("Michael O'Brien");
    expect(typo?.confidence).toBeGreaterThanOrEqual(60);
    expect(typo?.addressRisk).toBe(false);

    const red = rows.find((item) => item.trackingNumber === "YT-RED");
    expect(red?.matchedOrderId).toBe("SB-1004");
    expect(red?.addressRisk).toBe(true);
    expect(red?.addressWarning).toBe(SELLER_PROTECTION_WARNING);

    const orphan = rows.find((item) => item.trackingNumber === "YT-NONE");
    expect(orphan?.matchedOrderId).toBeNull();

    const exact = rows.find((item) => item.trackingNumber === "YT-OK");
    expect(exact?.matchedOrderId).toBe("SB-1001");
    expect(exact?.addressRisk).toBe(false);
  });
});
