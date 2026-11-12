import { NextResponse } from "next/server";
import { buildBuyerReply, sampleBuyerEmail } from "@/lib/buyer";
import { paypal } from "@/lib/paypal/gateway";
import { coerceMockState } from "@/lib/paypal/mock-state";
import type { Order } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { email?: string; orderId?: string; sample?: boolean; orders?: Order[] };
    const email = body.sample ? sampleBuyerEmail() : body.email || "";
    if (!email.trim()) return NextResponse.json({ ok: false, message: "Paste the buyer email" }, { status: 400 });
    const orders =
      paypal.mode() === "mock"
        ? coerceMockState(Array.isArray(body.orders) && body.orders.length ? { orders: body.orders } : undefined).orders
        : await paypal.listOrders();
    const reply = await buildBuyerReply(email, orders, body.orderId);
    return NextResponse.json(reply);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not draft a reply";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
