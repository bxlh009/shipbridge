/**
 * PayPal Add Tracking carrier codes.
 * Source (checked 2026-11-11):
 * https://developer.paypal.com/docs/tracking/reference/carriers/
 *
 * Confirmed enums:
 * - YunExpress → YUNEXPRESS (China section)
 * - 4PX / FOUR PX EXPRESS → FOUR_PX_EXPRESS (global section)
 * - Yanwen → YANWEN (China section)
 * - China Post → CN_CHINA_POST_EMS (this is the China Post / EMS code;
 *   the list has no separate CHINA_POST or CHINA_EMS value)
 * - DHL → DHL ("Dhl Global")
 * - UPS → UPS ("United Parcel Service")
 * - FedEx → FEDEX (United States section)
 * - USPS → USPS ("United States Postal Service")
 *
 * Unknown carriers use OTHER plus carrier_name_other (max 64 chars).
 */

export type CarrierMapping = {
  carrier: string;
  carrierNameOther?: string;
};

const RULES: { test: RegExp; carrier: string }[] = [
  { test: /yun\s*express|云途/i, carrier: "YUNEXPRESS" },
  { test: /\b4px\b|four[\s_-]*px|递四方/i, carrier: "FOUR_PX_EXPRESS" },
  { test: /yanwen|燕文/i, carrier: "YANWEN" },
  { test: /china\s*post|china\s*ems|\bems\b|中国邮政|邮政速递/i, carrier: "CN_CHINA_POST_EMS" },
  { test: /\bdhl\b/i, carrier: "DHL" },
  { test: /\bups\b/i, carrier: "UPS" },
  { test: /\bfedex\b|federal\s*express/i, carrier: "FEDEX" },
  { test: /\busps\b/i, carrier: "USPS" },
];

export function mapCarrier(input: string | undefined | null, fallbackName?: string): CarrierMapping {
  const raw = `${input || ""} ${fallbackName || ""}`.trim();
  for (const rule of RULES) {
    if (rule.test.test(raw)) return { carrier: rule.carrier };
  }
  const name = (input || fallbackName || "Unknown carrier").trim().slice(0, 64) || "Unknown carrier";
  return { carrier: "OTHER", carrierNameOther: name };
}

export function canonicalCarrierName(input: string | undefined | null, hint?: string): string {
  const mapped = mapCarrier(input, hint);
  switch (mapped.carrier) {
    case "YUNEXPRESS":
      return "YunExpress";
    case "FOUR_PX_EXPRESS":
      return "4PX";
    case "YANWEN":
      return "Yanwen";
    case "CN_CHINA_POST_EMS":
      return "China Post";
    case "DHL":
    case "UPS":
    case "FEDEX":
    case "USPS":
      return mapped.carrier;
    default:
      return (input || hint || mapped.carrierNameOther || "Unknown").trim();
  }
}
