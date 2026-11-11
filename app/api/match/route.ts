import { NextResponse } from "next/server";
import { adjudicate } from "@/lib/adjudicate";
import { matchRows } from "@/lib/matcher";
import { paypal } from "@/lib/paypal/gateway";
import { llmConfig } from "@/lib/paypal/mode";
import type { ManifestRow } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { rows?: ManifestRow[] };
    const rows = body.rows || [];
    if (!Array.isArray(rows) || !rows.length) {
      return NextResponse.json({ ok: false, message: "No manifest rows" }, { status: 400 });
    }
    const orders = await paypal.listOrders();
    const matched = matchRows(rows, orders);
    const adjudicated = await adjudicate(matched, orders);
    return NextResponse.json({ ok: true, llm: llmConfig().on, rows: adjudicated });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Match failed";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
