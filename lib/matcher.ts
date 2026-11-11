import { mapCarrier } from "./carriers";
import { keywordOverlap, nameSimilarity, normalizeCountry, normalizePostcode, normalizeRef } from "./text";
import { SELLER_PROTECTION_WARNING, type GridRow, type ManifestRow, type Order } from "./types";

const MATCH_THRESHOLD = 50;

export type PairScore = {
  confidence: number;
  reasons: string[];
  addressRisk: boolean;
  refMatch: boolean;
  nameSimilarity: number;
};

export function postcodeMismatch(rowPostcode: string, orderPostcode: string): boolean {
  const left = normalizePostcode(rowPostcode);
  const right = normalizePostcode(orderPostcode);
  if (!left || !right) return false;
  return left !== right;
}

export function countryMismatch(rowCountry: string, orderCountry: string): boolean {
  const left = normalizeCountry(rowCountry);
  const right = normalizeCountry(orderCountry);
  if (!left || !right) return false;
  return left !== right;
}

export function scorePair(row: Pick<ManifestRow, "recipientName" | "postcode" | "country" | "item" | "refNo">, order: Order): PairScore {
  const reasons: string[] = [];
  let score = 0;
  const refMatch = Boolean(row.refNo && normalizeRef(row.refNo) === normalizeRef(order.invoiceId));
  if (refMatch) {
    score += 42;
    reasons.push(`Invoice / reference ${order.invoiceId} matches`);
  }

  const similarity = nameSimilarity(row.recipientName, order.buyerName);
  score += Math.round(similarity * 32);
  if (similarity >= 0.98) reasons.push("Recipient name matches");
  else if (similarity >= 0.72) reasons.push("Recipient name is close (typo or transliteration)");
  else reasons.push("Recipient name is weak");

  const leftPost = normalizePostcode(row.postcode);
  const rightPost = normalizePostcode(order.postalCode);
  let addressRisk = false;
  if (leftPost && rightPost) {
    if (leftPost === rightPost) {
      score += 18;
      reasons.push("Postcode matches PayPal shipping address");
    } else {
      addressRisk = true;
      const prefix = Math.min(4, leftPost.length, rightPost.length);
      if (prefix >= 3 && leftPost.slice(0, prefix) === rightPost.slice(0, prefix)) {
        score += 4;
        reasons.push(`Postcode ${row.postcode} shares a prefix with PayPal ${order.postalCode} but does not match`);
      } else {
        reasons.push(`Postcode ${row.postcode} does not match PayPal ${order.postalCode}`);
      }
    }
  }

  if (row.country && order.country) {
    if (!countryMismatch(row.country, order.country)) {
      score += 8;
      reasons.push("Country matches");
    } else {
      addressRisk = true;
      score -= 12;
      reasons.push(`Country ${normalizeCountry(row.country)} does not match PayPal ${order.country}`);
    }
  }

  const overlap = keywordOverlap(row.item, order.item);
  if (overlap >= 0.99) {
    score += 12;
    reasons.push("Item name matches");
  } else if (overlap > 0) {
    score += Math.round(overlap * 8);
    reasons.push("Item keywords overlap");
  }

  const linked = refMatch || similarity >= 0.72;
  if (!linked) {
    score = Math.min(score, 35);
    reasons.push("Not enough identity overlap to auto-match");
  }

  return {
    confidence: Math.max(0, Math.min(100, Math.round(score))),
    reasons,
    addressRisk,
    refMatch,
    nameSimilarity: similarity,
  };
}

export function matchRows(manifest: ManifestRow[], orders: Order[]): GridRow[] {
  return manifest.map((row) => {
    let best: { order: Order; scored: PairScore } | null = null;
    for (const order of orders) {
      const scored = scorePair(row, order);
      if (!best || scored.confidence > best.scored.confidence) best = { order, scored };
    }
    const accept = Boolean(
      best && best.scored.confidence >= MATCH_THRESHOLD && (best.scored.refMatch || best.scored.nameSimilarity >= 0.72),
    );
    const order = accept && best ? best.order : null;
    const addressRisk = Boolean(order && best?.scored.addressRisk);
    const mapping = mapCarrier(row.carrier);
    return {
      ...row,
      id: row.trackingNumber,
      paypalCarrier: mapping.carrier,
      carrierNameOther: mapping.carrierNameOther,
      matchedOrderId: order?.id ?? null,
      buyerName: order?.buyerName ?? null,
      confidence: best?.scored.confidence ?? 0,
      reasons: best?.scored.reasons ?? ["No PayPal orders to compare"],
      addressRisk,
      addressWarning: addressRisk ? SELLER_PROTECTION_WARNING : "",
      syncStatus: "idle",
    };
  });
}
