const SECRET_KEYS = [
  "PAYPAL_CLIENT_ID",
  "PAYPAL_CLIENT_SECRET",
  "SANDBOX_BUYER_EMAIL",
  "SANDBOX_BUYER_PASSWORD",
  "SANDBOX_BUSINESS_EMAIL",
  "LLM_API_KEY",
];

/** Strip credentials, bearer tokens, and card numbers from text that may be logged. */
export function redact(input: string): string {
  let out = String(input);
  for (const key of SECRET_KEYS) {
    const value = process.env[key];
    if (value && value.length >= 4) out = out.split(value).join(`[${key}]`);
  }
  out = out.replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, "Bearer [redacted]");
  out = out.replace(/\b(?:\d[ -]*?){13,19}\b/g, "[card]");
  return out;
}
