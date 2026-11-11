import { NextResponse } from "next/server";
import { summarizeHolds } from "@/lib/holds";
import { paypal } from "@/lib/paypal/gateway";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const orders = await paypal.listOrders();
    return NextResponse.json({ ok: true, paypal: paypal.mode(), orders, stats: summarizeHolds(orders) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load orders";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
