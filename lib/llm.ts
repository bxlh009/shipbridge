import { llmConfig } from "./paypal/mode";

export function chatCompletionsUrl(baseURL: string): string {
  const base = baseURL.replace(/\/$/, "");
  if (base.endsWith("/chat/completions")) return base;
  return `${base}/chat/completions`;
}

type ContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

export async function chatComplete(options: {
  system?: string;
  user: string | ContentPart[];
  model?: string | null;
  temperature?: number;
}): Promise<string> {
  const cfg = llmConfig();
  if (!cfg.on || !cfg.model) throw new Error("LLM is not configured");
  const response = await fetch(chatCompletionsUrl(cfg.baseURL), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: options.model || cfg.model,
      temperature: options.temperature ?? 0,
      messages: [
        ...(options.system ? [{ role: "system", content: options.system }] : []),
        { role: "user", content: options.user },
      ],
    }),
  });
  const body = (await response.json()) as {
    error?: { message?: string };
    choices?: Array<{ message?: { content?: string } }>;
  };
  if (!response.ok) throw new Error(body.error?.message || `LLM request failed (${response.status})`);
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error("LLM returned an empty response");
  return content;
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
