import { generateText, stepCountIs, tool, type ToolSet } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { z } from "zod";
import type { GridRow } from "../types";
import { llmConfig } from "./mode";
import { paypal } from "./gateway";
import { syncRows } from "./sync";

type ToolMap = ToolSet;

function localTools(): ToolMap {
  return {
    get_order: tool({
      description: "Get a PayPal order by id, including shipping address, capture id, and any tracking already stored.",
      inputSchema: z.object({ orderId: z.string() }),
      execute: async ({ orderId }) => paypal.getOrder(orderId),
    }),
    create_shipment_tracking: tool({
      description:
        "Add a tracking number to a captured PayPal order. Uses Orders v2 /track and falls back to v1 trackers-batch. Reads the tracker back afterwards.",
      inputSchema: z.object({
        orderId: z.string(),
        trackingNumber: z.string(),
        carrier: z.string().describe("PayPal carrier code such as YUNEXPRESS, FOUR_PX_EXPRESS, YANWEN, or OTHER"),
        carrierNameOther: z.string().optional(),
      }),
      execute: async ({ orderId, trackingNumber, carrier, carrierNameOther }) =>
        paypal.addTracking({ orderId, trackingNumber, carrier, carrierNameOther }),
    }),
    get_shipment_tracking: tool({
      description: "Read back whether a tracking number is present on a PayPal order.",
      inputSchema: z.object({ orderId: z.string(), trackingNumber: z.string() }),
      execute: async ({ orderId, trackingNumber }) => {
        const verified = await paypal.readBack(orderId, trackingNumber);
        const order = await paypal.getOrder(orderId);
        return { verified, tracking: order?.tracking || [] };
      },
    }),
  };
}

async function toolkitTools(): Promise<{ tools: ToolMap; note: string }> {
  if (paypal.mode() === "mock") {
    return { tools: {}, note: "Agent toolkit is not called in mock mode. Local tools use the in-memory PayPal store." };
  }
  try {
    const imported = (await import("@paypal/agent-toolkit/ai-sdk")) as {
      PayPalAgentToolkit: new (args: {
        clientId: string;
        clientSecret: string;
        configuration: { actions: Record<string, Record<string, boolean>>; context?: { sandbox?: boolean } };
      }) => { getTools: () => Record<string, { description?: string; parameters?: unknown; inputSchema?: unknown; execute?: unknown }> };
    };
    const toolkit = new imported.PayPalAgentToolkit({
      clientId: process.env.PAYPAL_CLIENT_ID || "",
      clientSecret: process.env.PAYPAL_CLIENT_SECRET || "",
      configuration: {
        actions: {
          shipment: { create: true, show: true, cancel: false },
          orders: { create: false, get: true },
        },
        context: { sandbox: paypal.mode() === "sandbox" },
      },
    });
    const adapted: ToolMap = {};
    for (const [name, entry] of Object.entries(toolkit.getTools())) {
      adapted[name] = {
        description: entry.description || name,
        inputSchema: entry.inputSchema || entry.parameters,
        execute: entry.execute,
      } as ToolSet[string];
    }
    return {
      tools: adapted,
      note: "PayPal Agent Toolkit tools (create/get shipment tracking, get order) are registered for the model.",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "toolkit import failed";
    return { tools: {}, note: `Agent toolkit unavailable (${message}). Direct REST tools are used instead.` };
  }
}

function summarize(rows: GridRow[]): string {
  const verified = rows.filter((row) => row.syncStatus === "verified");
  const skipped = rows.filter((row) => row.syncStatus === "skipped");
  const failed = rows.filter((row) => row.syncStatus === "failed");
  return [
    `Synced ${verified.length} tracker(s) and read them back from PayPal.`,
    verified.map((row) => `${row.trackingNumber} → ${row.matchedOrderId} (${row.paypalCarrier}) verified in PayPal`).join("\n"),
    skipped.length ? `Skipped ${skipped.length}: ${skipped.map((row) => row.trackingNumber).join(", ")}` : "",
    failed.length ? `Failed ${failed.length}: ${failed.map((row) => `${row.trackingNumber} ${row.syncMessage}`).join("; ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function runAgent(instruction: string, rows: GridRow[]) {
  const loaded = await toolkitTools();
  const tools = { ...localTools(), ...loaded.tools };
  const cfg = llmConfig();
  if (!cfg.on || !cfg.model) {
    const synced = rows.length ? await syncRows(rows) : [];
    return {
      ok: true,
      engine: "deterministic",
      toolkit: loaded.note,
      text: rows.length
        ? `${summarize(synced)}\n\nNo LLM key is configured, so Agent mode ran the same sync tools directly.`
        : "No rows were provided. Pass manifest rows or configure an LLM to let the agent call PayPal tools.",
      rows: synced,
    };
  }

  const provider = createOpenAICompatible({
    name: "shipbridge",
    baseURL: cfg.baseURL,
    apiKey: cfg.apiKey,
  });
  try {
    const result = await generateText({
      model: provider.chatModel(cfg.model),
      tools,
      stopWhen: stepCountIs(8),
      system: [
        "You are ShipBridge, an operator for a Chinese cross-border seller.",
        "Use the PayPal tools to sync tracking numbers, then read them back.",
        "Prefer create_shipment_tracking, get_shipment_tracking, and get_order.",
        "Do not sync a row whose postcode or country conflicts with the PayPal shipping address unless the instruction explicitly says to include Seller Protection risks.",
        "notify the payer is never required. Keep the reply short.",
        loaded.note,
      ].join(" "),
      prompt: `${instruction}\n\nRows:\n${JSON.stringify(
        rows.map((row) => ({
          orderId: row.matchedOrderId,
          trackingNumber: row.trackingNumber,
          carrier: row.paypalCarrier,
          carrierNameOther: row.carrierNameOther,
          recipientName: row.recipientName,
          confidence: row.confidence,
          addressRisk: row.addressRisk,
          selected: row.selected,
        })),
      )}`,
    });
    return { ok: true, engine: "ai-sdk", toolkit: loaded.note, text: result.text, rows };
  } catch (error) {
    const synced = rows.length ? await syncRows(rows) : [];
    const message = error instanceof Error ? error.message : "agent failed";
    return {
      ok: true,
      engine: "deterministic-fallback",
      toolkit: loaded.note,
      text: `The LLM agent failed (${message}). Direct sync result:\n${summarize(synced)}`,
      rows: synced,
    };
  }
}
