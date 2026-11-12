import { afterEach, describe, expect, it, vi } from "vitest";
import { chatComplete, chatCompletionsUrl, extractJson, llmRequestHeaders, messageText } from "../lib/llm";

describe("llm helpers", () => {
  it("builds a chat completions URL", () => {
    expect(chatCompletionsUrl("https://openrouter.ai/api/v1")).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(chatCompletionsUrl("https://openrouter.ai/api/v1/")).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(chatCompletionsUrl("https://host/v1/chat/completions")).toBe("https://host/v1/chat/completions");
  });

  it("sends OpenRouter attribution headers without exposing extra secrets", () => {
    const headers = llmRequestHeaders("secret-key");
    expect(headers.Authorization).toBe("Bearer secret-key");
    expect(headers["HTTP-Referer"]).toBe("https://shipbridge-chi.vercel.app");
    expect(headers["X-Title"]).toBe("ShipBridge");
  });

  it("reads string or multipart message content", () => {
    expect(messageText("  hello  ")).toBe("hello");
    expect(messageText([{ type: "text", text: "ab" }, { type: "text", text: "cd" }])).toBe("abcd");
    expect(messageText(null)).toBe("");
  });

  it("extracts JSON from fences and prose", () => {
    expect(extractJson("```json\n{\"ok\":true}\n```")).toEqual({ ok: true });
    expect(extractJson("Sure.\n[{\"trackingNumber\":\"YT1\"}]\nThanks")).toEqual([{ trackingNumber: "YT1" }]);
  });
});

describe("chatComplete fallbacks", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.LLM_API_KEY;
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_MODEL;
    vi.unstubAllGlobals();
  });

  it("surfaces 429 as LLM_RATE_LIMITED", async () => {
    process.env.LLM_API_KEY = "test-key";
    process.env.LLM_BASE_URL = "https://openrouter.ai/api/v1";
    process.env.LLM_MODEL = "test/model:free";
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: "Rate limited" } }), { status: 429 }),
    ) as typeof fetch;
    await expect(chatComplete({ user: "hi" })).rejects.toThrow(/LLM_RATE_LIMITED/);
  });

  it("aborts a hung request with LLM_TIMEOUT", async () => {
    process.env.LLM_API_KEY = "test-key";
    process.env.LLM_BASE_URL = "https://openrouter.ai/api/v1";
    process.env.LLM_MODEL = "test/model:free";
    globalThis.fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      await new Promise((_, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const error = new Error("The operation was aborted.");
          error.name = "AbortError";
          reject(error);
        });
      });
      return new Response("{}");
    }) as typeof fetch;
    await expect(chatComplete({ user: "hi", timeoutMs: 20 })).rejects.toThrow("LLM_TIMEOUT");
  });
});
