export type PaypalMode = "mock" | "sandbox" | "live";

export function paypalMode(): PaypalMode {
  const requested = (process.env.PAYPAL_MODE || "").toLowerCase();
  const hasCreds = Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
  if (requested === "mock" || !hasCreds) return "mock";
  if (requested === "live" || (process.env.PAYPAL_ENV || "").toLowerCase() === "live") return "live";
  return "sandbox";
}

export function paypalApiBase(): string {
  const override = process.env.PAYPAL_BASE_URL?.trim();
  if (override) return override.replace(/\/$/, "");
  const env = (process.env.PAYPAL_ENV || process.env.PAYPAL_MODE || "sandbox").toLowerCase();
  return env === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
}

export function llmConfig() {
  const apiKey = process.env.LLM_API_KEY?.trim() || "";
  const baseURL = process.env.LLM_BASE_URL?.trim() || "";
  const model = process.env.LLM_MODEL?.trim() || "";
  const on = Boolean(apiKey && baseURL && model);
  return {
    on,
    apiKey,
    baseURL,
    model: on ? model : null,
    visionModel: on ? process.env.LLM_VISION_MODEL?.trim() || model : null,
  };
}
