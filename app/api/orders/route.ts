import { NextResponse } from "next/server";
import { summarizeHolds } from "@/lib/holds";
import { paypal } from "@/lib/paypal/gateway";
import { coerceMockState, mockTrackingPresent } from "@/lib/paypal/mock-state";
import type { Order } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const orders = await paypal.listOrders();
    return NextResponse.json({ ok: true, paypal: paypal.mode(), orders, stats: summarizeHolds(orders), source: paypal.mode() === "mock" ? "catalog" : "paypal" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load orders";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    if (paypal.mode() !== "mock") {
      const orders = await paypal.listOrders();
      return NextResponse.json({ ok: true, paypal: paypal.mode(), orders, stats: summarizeHolds(orders), source: "paypal" });
    }
    const body = (await request.json().catch(() => ({}))) as {
      orders?: Order[];
      readBack?: { orderId?: string; trackingNumber?: string };
    };
    const state = coerceMockState(Array.isArray(body.orders) && body.orders.length ? { orders: body.orders } : undefined);
    const orderId = body.readBack?.orderId || "";
    const trackingNumber = body.readBack?.trackingNumber || "";
    const readBack = orderId && trackingNumber ? { orderId, trackingNumber, verified: mockTrackingPresent(state, orderId, trackingNumber) } : undefined;
    return NextResponse.json({
      ok: true,
      paypal: "mock",
      orders: state.orders,
      stats: summarizeHolds(state.orders),
      source: Array.isArray(body.orders) && body.orders.length ? "client" : "catalog",
      readBack,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load orders";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
