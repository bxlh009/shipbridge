import type { GridRow, Order } from "./types";
import { chatComplete, extractJson } from "./llm";
import { llmConfig } from "./paypal/mode";

/** Ask the LLM to explain ambiguous matches. Never throws. */
export async function adjudicate(rows: GridRow[], orders: Order[]): Promise<GridRow[]> {
  if (!llmConfig().on) return rows;
  const ambiguous = rows.filter((row) => row.confidence >= 40 && row.confidence <= 80);
  if (!ambiguous.length) return rows;
  try {
    const raw = await chatComplete({
      system:
        "You adjudicate shipping-manifest matches for a PayPal seller. Reply with a JSON array of {trackingNumber, orderId, explanation}. explanation is one English sentence. Only choose an orderId from the candidates. If none fit, use null.",
      user: JSON.stringify({
        rows: ambiguous.map((row) => ({
          trackingNumber: row.trackingNumber,
          recipientName: row.recipientName,
          postcode: row.postcode,
          country: row.country,
          item: row.item,
          refNo: row.refNo,
          currentOrderId: row.matchedOrderId,
          confidence: row.confidence,
          reasons: row.reasons,
        })),
        orders: orders.map((order) => ({
          id: order.id,
          buyerName: order.buyerName,
          postalCode: order.postalCode,
          country: order.country,
          item: order.item,
          invoiceId: order.invoiceId,
        })),
      }),
    });
    const parsed = extractJson(raw);
    if (!Array.isArray(parsed)) return rows;
    const notes = new Map<string, { orderId?: string | null; explanation?: string }>();
    for (const item of parsed) {
      const row = item as { trackingNumber?: string; orderId?: string | null; explanation?: string };
      if (row.trackingNumber) notes.set(row.trackingNumber, row);
    }
    return rows.map((row) => {
      const note = notes.get(row.trackingNumber);
      if (!note?.explanation) return row;
      const suggested = note.orderId ? orders.find((order) => order.id === note.orderId) : undefined;
      if (suggested && suggested.id !== row.matchedOrderId && row.confidence <= 80) {
        return {
          ...row,
          matchedOrderId: suggested.id,
          buyerName: suggested.buyerName,
          llmNote: note.explanation,
          reasons: [...row.reasons, `LLM: ${note.explanation}`],
        };
      }
      return { ...row, llmNote: note.explanation, reasons: [...row.reasons, `LLM: ${note.explanation}`] };
    });
  } catch {
    return rows;
  }
}
