import { canonicalCarrierName } from "./carriers";
import { normalizeCountry } from "./text";
import type { ManifestRow } from "./types";
import { chatComplete, extractJson } from "./llm";
import { llmConfig } from "./paypal/mode";

export async function parseManifestImage(dataUrl: string): Promise<ManifestRow[]> {
  const cfg = llmConfig();
  if (!cfg.on) {
    throw new Error("LLM_UNAVAILABLE");
  }
  const raw = await chatComplete({
    model: cfg.visionModel,
    system:
      "Extract shipping manifest rows from the image. Reply with a JSON array only. Each object has trackingNumber, carrier, recipientName, postcode, country, city, item, qty, refNo. Use ISO country codes when possible. Do not invent rows that are not visible.",
    user: [
      { type: "text", text: "Read this shipping manifest screenshot and return the JSON rows." },
      { type: "image_url", image_url: { url: dataUrl } },
    ],
  });
  const parsed = extractJson(raw);
  if (!Array.isArray(parsed)) throw new Error("Vision model did not return a JSON array");
  return parsed
    .map((item) => {
      const row = item as Record<string, unknown>;
      const trackingNumber = String(row.trackingNumber || "").trim();
      if (!trackingNumber) return null;
      const qty = Number(row.qty || 1);
      const manifest: ManifestRow = {
        trackingNumber,
        carrier: canonicalCarrierName(String(row.carrier || "")),
        recipientName: String(row.recipientName || ""),
        postcode: String(row.postcode || ""),
        country: normalizeCountry(String(row.country || "")),
        city: String(row.city || ""),
        item: String(row.item || ""),
        qty: Number.isFinite(qty) && qty > 0 ? qty : 1,
        refNo: String(row.refNo || ""),
        source: "screenshot",
      };
      return manifest;
    })
    .filter((row): row is ManifestRow => Boolean(row));
}
