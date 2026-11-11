import { NextResponse } from "next/server";
import { summarizeHolds } from "@/lib/holds";
import { paypal } from "@/lib/paypal/gateway";
import { syncRows } from "@/lib/paypal/sync";
import type { GridRow, Order } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { rows?: GridRow[]; orders?: Order[] };
    const rows = body.rows || [];
    if (!Array.isArray(rows) || !rows.length) {
      return NextResponse.json({ ok: false, message: "No rows to sync" }, { status: 400 });
    }
    const synced = await syncRows(rows, body.orders);
    const orders = synced.orders ?? (await paypal.listOrders());
    const stats = synced.stats ?? summarizeHolds(orders);
    return NextResponse.json({
      ok: true,
      paypal: paypal.mode(),
      rows: synced.rows,
      orders,
      stats,
      verified: synced.rows.filter((row) => row.syncStatus === "verified").length,
      carrierResults: synced.carrierResults,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sync failed";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
