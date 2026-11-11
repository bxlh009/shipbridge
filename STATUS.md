# ShipBridge status

Updated 2026-11-11 after a local mock-mode run.

## Built

- Next.js App Router + TypeScript + Tailwind UI with EN / 中文 toggle, PayPal-blue header, simulated-hold banner, and stat cards.
- Manifest parser for YunExpress, 4PX, and Yanwen CSV/XLSX, including Chinese headers. Screenshot path calls an OpenAI-compatible vision chat and, with no key, returns `LLM_UNAVAILABLE` plus the sample list.
- SAMPLE files in `public/samples/`: `yunexpress-sample.csv`, `4px-sample.xlsx`, `yanwen-sample.csv`. Buyers are fake. They line up with mock orders SB-1001–SB-1009. Noah Bennett has no order. Anna Schmidt’s postcode 10117 does not match PayPal 10115. Micheal Obrien and Chloe Davis are name variants.
- Deterministic matcher (name, postcode, country, item, invoice id) and optional LLM adjudication that fails soft.
- AG Grid Community review grid with checkbox selection, confidence badge, red Seller Protection rows, override dropdown, and green “verified in PayPal” only after read-back.
- Sync via Orders v2 `POST /v2/checkout/orders/{id}/track`, fallback `POST /v1/shipping/trackers-batch`. Carrier map in `lib/carriers.ts` (`YUNEXPRESS`, `FOUR_PX_EXPRESS`, `YANWEN`, `CN_CHINA_POST_EMS`, `DHL`, `UPS`, `FEDEX`, `USPS`, otherwise `OTHER`).
- In-memory mock store (default). Sandbox seed (`scripts/seed-sandbox.ts`) and capture (`scripts/capture.ts`). OAuth client-credentials cache in `lib/paypal/rest.ts`.
- Buyer reply: Chinese brief + English draft with a labeled simulated timeline. Template when AI is off.
- `POST /api/agent`: Vercel AI SDK tools. In sandbox/live, `@paypal/agent-toolkit` `PayPalAgentToolkit` tools are registered when the package loads. Mock mode and toolkit failures use the direct client. No LLM key runs the same sync deterministically.
- `GET /api/health`, vitest tests, `scripts/verify.mjs`, `scripts/screenshot.mjs`.

## Verification

- `npm test`: 6 tests passed (manifest parsing, carrier mapping, typo match, postcode mismatch flag).
- `npx tsc --noEmit`: passed.
- `npx next build`: passed (Next.js 15.5.29).
- `PAYPAL_MODE=mock npm run start` on port 3000, then `node scripts/verify.mjs`: **ALL PASS**
  - health, seed reset, orders, parse sample manifests, match, sync, read-back, explicit risk-row sync, buyer-reply, screenshot without LLM, agent deterministic.
- `node scripts/screenshot.mjs`: wrote `screenshots/home.png`, `matched-grid.png`, `synced.png`, `buyer-reply.png`, `chinese.png`. Playwright Chromium launched. The grid fits a 1440px viewport: confidence, address check, and sync status are visible, all 10 sample rows show, and the postcode-mismatch row uses a one-line "PayPal address mismatch" label. The full Seller Protection sentence stays in the banner above the grid.

## Not verified

- No PayPal sandbox credentials in this environment, so live OAuth, order create, capture, and the real Orders v2 track call were not executed. The REST client and seed/capture scripts are implemented and covered by code review only.
- No LLM key, so vision parsing and LLM adjudication were not called against a model. The no-key paths were verified.
- `public/samples/manifest-screenshot-SAMPLE.png` is a rendered fake YunExpress grid for the screenshot upload demo. Vision parsing was not called because no LLM key is set.

## TODOs

- Run `scripts/seed-sandbox.ts` and `scripts/capture.ts` against a real sandbox business app, then sync one SAMPLE row and confirm PayPal’s read-back.
- Point `LLM_BASE_URL`, `LLM_API_KEY`, and `LLM_MODEL` at an OpenAI-compatible model and retry a manifest screenshot plus an ambiguous-row explanation.
- Persist the mock store if this is deployed on Vercel (serverless instances do not share memory).
- Carrier delivery webhooks and an item-not-received evidence pack.
