import { NextResponse } from "next/server";
import { llmConfig, paypalMode } from "@/lib/paypal/mode";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  const llm = llmConfig();
  const mode = paypalMode();
  return NextResponse.json({
    ok: true,
    paypal: mode,
    paypalEnv: mode === "mock" ? "mock" : (process.env.PAYPAL_ENV || mode),
    ai: llm.on ? llm.model : "off",
    model: llm.model,
    visionModel: llm.visionModel,
  });
}
