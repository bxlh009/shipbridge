import { describe, expect, it } from "vitest";
import { mapCarrier } from "@/lib/carriers";

describe("carrier mapping", () => {
  it("maps the China cross-border carriers PayPal publishes", () => {
    expect(mapCarrier("YunExpress")).toEqual({ carrier: "YUNEXPRESS" });
    expect(mapCarrier("云途")).toEqual({ carrier: "YUNEXPRESS" });
    expect(mapCarrier("4PX")).toEqual({ carrier: "FOUR_PX_EXPRESS" });
    expect(mapCarrier("递四方")).toEqual({ carrier: "FOUR_PX_EXPRESS" });
    expect(mapCarrier("Yanwen")).toEqual({ carrier: "YANWEN" });
    expect(mapCarrier("燕文")).toEqual({ carrier: "YANWEN" });
  });

  it("maps common carriers and falls back to OTHER", () => {
    expect(mapCarrier("China Post").carrier).toBe("CN_CHINA_POST_EMS");
    expect(mapCarrier("China EMS").carrier).toBe("CN_CHINA_POST_EMS");
    expect(mapCarrier("DHL").carrier).toBe("DHL");
    expect(mapCarrier("UPS").carrier).toBe("UPS");
    expect(mapCarrier("FedEx").carrier).toBe("FEDEX");
    expect(mapCarrier("USPS").carrier).toBe("USPS");
    expect(mapCarrier("Local Bike Courier")).toEqual({ carrier: "OTHER", carrierNameOther: "Local Bike Courier" });
  });
});
