import { NextResponse } from "next/server";
import { summarizeHolds } from "@/lib/holds";
import { CATALOG, freshOrders } from "@/lib/paypal/catalog";
import { paypalMode } from "@/lib/paypal/mode";
import { createSandboxOrder } from "@/lib/paypal/rest";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  if (paypalMode() === "mock") {
    const orders = freshOrders();
    return NextResponse.json({ ok: true, mode: "mock", orders, stats: summarizeHolds(orders), source: "catalog" });
  }
  try {
    const created = [];
    for (const template of CATALOG) {
      created.push({ localId: template.id, ...(await createSandboxOrder(template)) });
    }
    return NextResponse.json({
      ok: true,
      mode: paypalMode(),
      orders: created,
      note: "Approve each link with a sandbox personal buyer, then run scripts/capture.ts.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Seed failed";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
