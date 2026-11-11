import { NextResponse } from "next/server";
import { syncRows } from "@/lib/paypal/sync";
import type { GridRow } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { rows?: GridRow[] };
    const rows = body.rows || [];
    if (!Array.isArray(rows) || !rows.length) {
      return NextResponse.json({ ok: false, message: "No rows to sync" }, { status: 400 });
    }
    const synced = await syncRows(rows);
    return NextResponse.json({
      ok: true,
      paypal: "see health",
      rows: synced,
      verified: synced.filter((row) => row.syncStatus === "verified").length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sync failed";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
