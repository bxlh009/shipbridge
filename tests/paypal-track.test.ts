import { describe, expect, it } from "vitest";
import { isAlreadyTracked, isCarrierRejection } from "@/lib/paypal/rest";

describe("PayPal tracking errors", () => {
  it("treats a carrier field rejection as a reason to fall back", () => {
    const payload = {
      name: "UNPROCESSABLE_ENTITY",
      details: [{ field: "/carrier", issue: "INVALID_PARAMETER_VALUE", description: "Carrier is not supported." }],
    };
    expect(isCarrierRejection(422, payload)).toBe(true);
    expect(isCarrierRejection(422, { name: "UNPROCESSABLE_ENTITY", details: [{ field: "/tracking_number", issue: "MISSING" }] })).toBe(false);
    expect(isCarrierRejection(500, payload)).toBe(false);
  });

  it("recognizes a tracker that is already on the order", () => {
    expect(isAlreadyTracked({ details: [{ issue: "TRACKING_NUMBER_ALREADY_ADDED", description: "Tracking already added." }] })).toBe(true);
    expect(isAlreadyTracked({ message: "The order is not captured." })).toBe(false);
  });
});
