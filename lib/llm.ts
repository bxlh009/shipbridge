import { llmConfig } from "./paypal/mode";

const DEFAULT_TIMEOUT_MS = 8_000;
const VISION_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_TOKENS = 2_048;

export function chatCompletionsUrl(baseURL: string): string {
  const base = baseURL.replace(/\/$/, "");
  if (base.endsWith("/chat/completions")) return base;
  return `${base}/chat/completions`;
}

export function llmRequestHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    // OpenRouter ranks and sometimes requires these; harmless for other OpenAI-compatible hosts.
    "HTTP-Referer": process.env.LLM_HTTP_REFERER?.trim() || "https://shipbridge-chi.vercel.app",
    "X-Title": process.env.LLM_APP_TITLE?.trim() || "ShipBridge",
  };
}

export function messageText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          return String((part as { text?: unknown }).text || "");
        }
        return "";
      })
      .join("")
      .trim();
  }
  return "";
}

type ContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

function timeoutMsFor(user: string | ContentPart[], explicit?: number): number {
  if (explicit && explicit > 0) return explicit;
  const fromEnv = Number(process.env.LLM_TIMEOUT_MS);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  const hasImage = Array.isArray(user) && user.some((part) => part.type === "image_url");
  if (hasImage) {
    const vision = Number(process.env.LLM_VISION_TIMEOUT_MS);
    if (Number.isFinite(vision) && vision > 0) return vision;
    return VISION_TIMEOUT_MS;
  }
  return DEFAULT_TIMEOUT_MS;
}

export async function chatComplete(options: {
  system?: string;
  user: string | ContentPart[];
  model?: string | null;
  temperature?: number;
  timeoutMs?: number;
  maxTokens?: number;
}): Promise<string> {
  const cfg = llmConfig();
  if (!cfg.on || !cfg.model) throw new Error("LLM is not configured");
  const timeoutMs = timeoutMsFor(options.user, options.timeoutMs);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(chatCompletionsUrl(cfg.baseURL), {
      method: "POST",
      headers: llmRequestHeaders(cfg.apiKey),
      signal: controller.signal,
      body: JSON.stringify({
        model: options.model || cfg.model,
        temperature: options.temperature ?? 0,
        max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
        messages: [
          ...(options.system ? [{ role: "system", content: options.system }] : []),
          { role: "user", content: options.user },
        ],
      }),
    });
    const body = (await response.json()) as {
      error?: { message?: string };
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    if (!response.ok) {
      const detail = body.error?.message || `LLM request failed (${response.status})`;
      if (response.status === 429) throw new Error(`LLM_RATE_LIMITED: ${detail}`);
      throw new Error(detail);
    }
    const content = messageText(body.choices?.[0]?.message?.content);
    if (!content) throw new Error("LLM returned an empty response");
    return content;
  } catch (error) {
    if (error instanceof Error && (error.name === "AbortError" || error.message === "The operation was aborted.")) {
      throw new Error("LLM_TIMEOUT");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : text;
  const start = raw.search(/[\[{]/);
  if (start < 0) throw new Error("No JSON in LLM response");
  const opening = raw[start];
  const closing = opening === "{" ? "}" : "]";
  let depth = 0;
  for (let i = start; i < raw.length; i++) {
    if (raw[i] === opening) depth += 1;
    else if (raw[i] === closing) {
      depth -= 1;
      if (depth === 0) return JSON.parse(raw.slice(start, i + 1));
    }
  }
  return JSON.parse(raw.slice(start));
}
