import { NextResponse } from "next/server";
import { summarizeHolds } from "@/lib/holds";
import { freshOrders } from "@/lib/paypal/catalog";
import { paypal } from "@/lib/paypal/gateway";
import { paypalMode } from "@/lib/paypal/mode";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  if (paypalMode() === "mock") {
    const orders = freshOrders();
    return NextResponse.json({ ok: true, mode: "mock", orders, stats: summarizeHolds(orders), source: "catalog" });
  }
  try {
    const orders = await paypal.listOrders();
    return NextResponse.json({
      ok: true,
      mode: paypalMode(),
      orders,
      stats: summarizeHolds(orders),
      source: "paypal",
      note: "Sandbox orders are created by scripts/seed-sandbox.ts so card captures stay out of this route. This response lists the local registry.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Seed failed";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
