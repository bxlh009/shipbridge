import { NextResponse } from "next/server";
import { runAgent } from "@/lib/paypal/agent";
import type { GridRow } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { instruction?: string; rows?: GridRow[] };
    const instruction = body.instruction?.trim() || "Sync tracking for these rows and read each tracking number back.";
    const result = await runAgent(instruction, body.rows || []);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Agent failed";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
