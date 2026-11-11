import { buildTimeline, type TimelineEvent } from "./timeline";
import { nameSimilarity } from "./text";
import type { Order } from "./types";
import { chatComplete, extractJson } from "./llm";
import { llmConfig } from "./paypal/mode";

export type BuyerReply = {
  ok: true;
  source: "template" | "llm";
  detectedOrderId: string | null;
  buyerName: string | null;
  trackingNumber: string | null;
  carrier: string | null;
  chinese: { summary: string; mood: string; ask: string; disputeRisk: string };
  englishReply: string;
  timeline: TimelineEvent[];
  timelineNote: string;
};

const SAMPLE_EMAIL = `Subject: WHERE IS MY ORDER??

Hi,
I paid last week and still nothing. This is ridiculous!
Order SB-1001. My name is Emily Carter.
I want the tracking number NOW or I will open a PayPal dispute.

Thanks,
Emily`;

export function sampleBuyerEmail(): string {
  return SAMPLE_EMAIL;
}

export function detectOrder(email: string, orders: Order[], explicitId?: string): Order | null {
  if (explicitId) {
    const chosen = orders.find((order) => order.id.toLowerCase() === explicitId.toLowerCase() || order.invoiceId.toLowerCase() === explicitId.toLowerCase());
    if (chosen) return chosen;
  }
  const idMatch = email.match(/\b(SB-\d{3,}|INV-\d{3,})\b/i);
  if (idMatch) {
    const token = idMatch[1].toLowerCase();
    const byId = orders.find((order) => order.id.toLowerCase() === token || order.invoiceId.toLowerCase() === token);
    if (byId) return byId;
  }
  const lower = email.toLowerCase();
  for (const order of orders) {
    const parts = order.buyerName
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .replace(/['’]/g, "")
      .split(/\s+/)
      .filter((part) => part.length > 2);
    if (parts.length >= 2 && parts.every((part) => lower.includes(part))) return order;
  }
  let best: { order: Order; score: number } | null = null;
  for (const order of orders) {
    const score = nameSimilarity(order.buyerName, email);
    if (!best || score > best.score) best = { order, score };
  }
  if (best && best.score >= 0.45) return best.order;
  return null;
}

function moodOf(email: string): { mood: string; dispute: string; urgent: boolean } {
  const dispute = /dispute|chargeback|claim|scam|lawyer|refund/i.test(email);
  const urgent = dispute || /!{2,}|asap|immediately|where is my order|ridiculous|angry|now/i.test(email);
  return {
    urgent,
    mood: urgent ? "不耐烦，催得比较急，语气偏强硬。" : "正常询问，情绪平稳。",
    dispute: dispute
      ? "高。信里出现了争议、拒付或退款的字样，建议今天就回物流信息。"
      : urgent
        ? "中。买家在催单，如果继续没有单号，有可能升级成未收到货争议。"
        : "低。先把单号和预计送达时间写清楚即可。",
  };
}

function englishDraft(order: Order | null, timeline: TimelineEvent[]): string {
  if (!order) {
    return [
      "Hi,",
      "",
      "Thanks for writing. I could not match this email to one PayPal order yet.",
      "Please reply with the order number or the name on the PayPal payment and I will send the tracking details.",
      "",
      "Best regards,",
      "Customer care",
    ].join("\n");
  }
  const tracking = order.tracking.find((item) => item.verified) || order.tracking[0];
  const first = order.buyerName.split(" ")[0];
  const lines = [
    `Hi ${first},`,
    "",
    `Thanks for your message about PayPal order ${order.id}.`,
  ];
  if (tracking) {
    lines.push(
      "Your package has shipped.",
      "",
      `Carrier: ${carrierLabel(tracking.carrier, tracking.carrierNameOther)}`,
      `Tracking number: ${tracking.trackingNumber}`,
      "",
      "Tracking timeline (simulated demo estimate, not a live carrier scan):",
      ...timeline.map((event) => `- ${event.date}: ${event.label}`),
    );
  } else {
    lines.push(
      "Your payment is in our shipping queue. We will email the carrier and tracking number as soon as the label is created.",
      "",
      "Tracking timeline (simulated demo estimate, not a live carrier scan):",
      ...timeline.map((event) => `- ${event.date}: ${event.label}`),
    );
  }
  lines.push("", "The parcel is addressed only to the shipping address on your PayPal payment.", "", "Best regards,", "Customer care");
  return lines.join("\n");
}

function carrierLabel(code: string, other?: string): string {
  if (code === "OTHER") return other || "Other";
  if (code === "YUNEXPRESS") return "YunExpress";
  if (code === "FOUR_PX_EXPRESS") return "4PX";
  if (code === "YANWEN") return "Yanwen";
  if (code === "CN_CHINA_POST_EMS") return "China Post";
  return code;
}

export async function buildBuyerReply(email: string, orders: Order[], explicitId?: string): Promise<BuyerReply> {
  const order = detectOrder(email, orders, explicitId);
  const tracking = order?.tracking.find((item) => item.verified) || order?.tracking[0];
  const carrier = tracking?.carrier || order?.plannedCarrier || "YUNEXPRESS";
  const timeline = order ? buildTimeline(order.shipDate, carrier, order.country) : [];
  const tone = moodOf(email);
  const chinese = {
    summary: order
      ? `买家在问订单 ${order.id}（${order.buyerName}，${order.item}，${order.currency} ${order.amount}）的物流。${tracking ? `已有单号 ${tracking.trackingNumber}。` : "这笔订单还没有回传单号。"}`
      : "这封邮件里没有对上任何一笔 PayPal 订单。需要买家补充订单号或付款姓名。",
    mood: tone.mood,
    ask: tracking ? "买家想要单号、承运商和大概什么时候能到。" : "买家想知道货在哪里，并希望马上拿到物流单号。",
    disputeRisk: tone.dispute,
  };
  const template = englishDraft(order, timeline);
  const base: BuyerReply = {
    ok: true,
    source: "template",
    detectedOrderId: order?.id ?? null,
    buyerName: order?.buyerName ?? null,
    trackingNumber: tracking?.trackingNumber ?? null,
    carrier: tracking ? carrierLabel(tracking.carrier, tracking.carrierNameOther) : order ? carrierLabel(carrier) : null,
    chinese,
    englishReply: template,
    timeline,
    timelineNote: "Simulated tracking timeline for the demo. It is generated from the ship date and a carrier transit table, not from a live scan.",
  };

  if (!llmConfig().on) return base;
  try {
    const raw = await chatComplete({
      system:
        "You help a Chinese cross-border seller answer an English PayPal buyer. Return JSON only with keys summary, mood, ask, disputeRisk, englishReply. summary, mood, ask, and disputeRisk must be Simplified Chinese. englishReply must be polite English and must include the tracking number when one is provided. Do not invent a different tracking number.",
      user: JSON.stringify({
        email,
        order: order
          ? {
              id: order.id,
              buyerName: order.buyerName,
              item: order.item,
              amount: `${order.currency} ${order.amount}`,
              trackingNumber: tracking?.trackingNumber || null,
              carrier: base.carrier,
              shipDate: order.shipDate,
            }
          : null,
        timeline,
        timelineNote: base.timelineNote,
      }),
    });
    const parsed = extractJson(raw) as Partial<BuyerReply["chinese"] & { englishReply: string }>;
    const english = typeof parsed.englishReply === "string" ? parsed.englishReply.trim() : "";
    const trackingOk = !tracking || english.includes(tracking.trackingNumber);
    return {
      ...base,
      source: trackingOk && english ? "llm" : "template",
      chinese: {
        summary: parsed.summary || chinese.summary,
        mood: parsed.mood || chinese.mood,
        ask: parsed.ask || chinese.ask,
        disputeRisk: parsed.disputeRisk || chinese.disputeRisk,
      },
      englishReply: trackingOk && english ? english : template,
    };
  } catch {
    return base;
  }
}
