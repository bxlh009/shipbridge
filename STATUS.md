# ShipBridge status

Updated 2026-11-11 after a local mock-mode run.

## Built

- Next.js App Router + TypeScript + Tailwind UI with EN / 中文 toggle, PayPal-blue hero, simulated-hold banner, and stat cards.
- Hero pitch for PayPal (fewer item-not-received disputes, faster release, keeping cross-border merchants) plus a subline for Chinese sellers on YunExpress, 4PX, and Yanwen. Guided demo: Load sample → Match → Sync. The current step is highlighted, later steps stay disabled, and a check marks each finished step. Both languages.
- Manifest parser for YunExpress, 4PX, and Yanwen CSV/XLSX, including Chinese headers. Screenshot path calls an OpenAI-compatible vision chat and, with no key, returns `LLM_UNAVAILABLE` plus the sample list.
- SAMPLE files in `public/samples/`: `yunexpress-sample.csv`, `4px-sample.xlsx`, `yanwen-sample.csv`. Buyers are fake. They line up with mock orders SB-1001–SB-1009. Noah Bennett has no order. Anna Schmidt’s postcode 10117 does not match PayPal 10115. Micheal Obrien and Chloe Davis are name variants.
- Deterministic matcher (name, postcode, country, item, invoice id) and optional LLM adjudication that fails soft.
- AG Grid Community review grid with checkbox selection, confidence badge, red Seller Protection rows, override dropdown, and green “verified in PayPal” only after read-back.
- Sync via Orders v2 `POST /v2/checkout/orders/{id}/track`, fallback `POST /v1/shipping/trackers-batch`. Carrier map in `lib/carriers.ts` (`YUNEXPRESS`, `FOUR_PX_EXPRESS`, `YANWEN`, `CN_CHINA_POST_EMS`, `DHL`, `UPS`, `FEDEX`, `USPS`, otherwise `OTHER`).
- Mock mode is stateless on the server. Orders are seeded from the fixed catalog. The browser keeps orders and trackers in `localStorage`. Sync and read-back send that state and get the next copy back. Read-back is true only when the tracking number is on the returned order. **Reset demo** clears `localStorage`. Sandbox and live mode stay on server-side REST.
- After a verified sync, payments on hold count down and “Releasing early” counts up (release pending delivery), with a short highlight. Sample run: 10 → 2 on hold, $0.00 → $206.79 releasing early, 7.5 days earlier. Labels stay Simulated.
- Sandbox seed (`scripts/seed-sandbox.ts`) creates COMPLETED captures with `payment_source.card` and `PayPal-Request-Id`. The gitignored registry `.data/sandbox-orders.json` is what `GET /api/orders` lists, via `GET /v2/checkout/orders/{id}`. Transaction Search is not used. `scripts/capture.ts` finishes any order that still needs a buyer approval.
- Buyer reply: Chinese brief + English draft with a labeled simulated timeline. Template when AI is off.
- `POST /api/agent`: Vercel AI SDK tools. In sandbox/live, `@paypal/agent-toolkit` `PayPalAgentToolkit` tools are registered when the package loads. Mock mode and toolkit failures use the direct client against the orders sent with the request. No LLM key runs the same sync deterministically.
- `GET /api/health`, vitest tests, `scripts/verify.mjs`, `scripts/screenshot.mjs`.

## Verification

- `npm test`: 10 tests passed (manifest parsing, carrier mapping, typo match, postcode mismatch flag, stateless mock sync, read-back that ignores a lying `verified` flag, carrier-rejection detection).
- `npx next build`: passed (Next.js 15.5.29). `next build` loads `.env.local` but does not inline the server credentials into the client bundle.
- Env precedence: `@next/env` `loadEnvConfig` keeps a process-environment value and fills only missing keys from `.env.local`, which beats `.env`. Confirmed on the running app: `PAYPAL_MODE=mock npm run start` with a sandbox `.env.local` returned `GET /api/health` `paypal=mock`. `npm run start` with no shell `PAYPAL_MODE` returned `paypal=sandbox`.
- `PAYPAL_MODE=mock npm run start` on port 3000, then `node scripts/verify.mjs`: **ALL PASS**
  - health, seed reset, orders, parse sample manifests, match, sync, mock stateless (GET /api/orders does not remember the tracker), read-back (number present, missing number false, spoofed `verified: true` without the number is false), explicit risk-row sync, buyer-reply, screenshot without LLM, agent deterministic.
- `node scripts/screenshot.mjs`: wrote `screenshots/hero.png`, `home.png`, `matched-grid.png`, `after-sync.png`, `synced.png`, `buyer-reply.png`, `chinese.png`. The shot waits until the count-up sets `data-settled="true"`. After sync the big “Releasing early” figure is `$206.79`, the same amount as the subline `$0.00 → $206.79`. Payments on hold show `10 → 2`. Each step has a check.

## Sandbox run

Real sandbox business app. Advanced Card Payments is on. Customer disputes and Transaction Search are not, so orders come from `.data/sandbox-orders.json`, not `/v1/reporting/transactions`.

`npx tsx scripts/seed-sandbox.ts` created 10 COMPLETED USD captures with Visa `4032039317984658` (expiry `2030-12`), US card billing, and the sample ship-to address. No buyer approval links were required. No `## Browser approvals needed` section.

| Invoice | Buyer | PayPal order | Capture |
| --- | --- | --- | --- |
| INV-1001 | Emily Carter | `46466510JT843580T` | `4SH54261RS191471F` |
| INV-1002 | James Whitaker | `6VU89194N23205232` | `67L613662R574883P` |
| INV-1003 | Michael O'Brien | `5M77411772498893R` | `22D92012DU3749247` |
| INV-1004 | Anna Schmidt (postcode 10115) | `2SR82036UD2826732` | `72X0043400302174P` |
| INV-1005 | Sophie Martin | `19B8280704708801P` | `0SF356550X901461S` |
| INV-1006 | Liam Nguyen | `75783188LP5347535` | `58Y56063XV526591K` |
| INV-1007 | Olivia Brooks | `7UD17849UW068661C` | `44U440721D949160P` |
| INV-1008 | Chloe Davies | `5G612716UB399841R` | `7SJ01506NN832883V` |
| INV-1009 | Lukas Weber | `6UV388971X657933P` | `1BA49138WT051521G` |
| INV-1010 | Ava Thompson | `6NX500168U8006720` | `4TR28212CW812225E` |

`npm run start -- -p 3001`, then `SHIPBRIDGE_URL=http://127.0.0.1:3001 node scripts/verify-sandbox.mjs`: **ALL PASS**. Redacted output is `sandbox-run.log` (gitignored).

- Health reported `paypal=sandbox`.
- 10 orders, each `COMPLETED` with a capture id. Anna Schmidt’s PayPal postcode is `10115`. Noah Bennett has no order.
- Sample manifests parsed (10 rows). Anna flagged red (Seller Protection). Micheal Obrien matched Michael O'Brien. Chloe Davis matched Chloe Davies. Noah unmatched.
- Sync skipped Anna by default. Eight other manifest rows verified.
- Carrier codes accepted on Orders v2 `POST /v2/checkout/orders/{id}/track` with no fallback: `YUNEXPRESS`, `FOUR_PX_EXPRESS`, `YANWEN`. No API error on those calls.
- Read-back found each tracking number on `GET /v2/checkout/orders/{id}` (`purchase_units[].shipping.trackers`). Anna’s number `YT202611110004` was not written.
- `screenshots/sandbox-synced.png`: status chip `PayPal: sandbox`, 8 verified, Anna’s row red and skipped, releasing early `$206.79`, 2 still on hold (`$36.50`, Anna plus Ava). Sandbox “days released earlier” is 10.9 because `paidAt` is the PayPal create date (11 Nov 2026) while the catalog ship dates are earlier. The mock catalog’s paid dates sit closer to the ship dates, so that demo still averages 7.5.

GET order is retried on HTTP 429 and 5xx. A single dropped id during sync is fetched again before the row is marked missing.

## Not verified

- No LLM key, so vision parsing and LLM adjudication were not called against a model. The no-key paths were verified.
- `public/samples/manifest-screenshot-SAMPLE.png` is a rendered fake YunExpress grid for the screenshot upload demo. Vision parsing was not called because no LLM key is set.
- Live (`PAYPAL_ENV=live`) was not called.

## TODOs

- Point `LLM_BASE_URL`, `LLM_API_KEY`, and `LLM_MODEL` at an OpenAI-compatible model and retry a manifest screenshot plus an ambiguous-row explanation.
- Carrier delivery webhooks and an item-not-received evidence pack.
- Hackathon deliverables that still need the user: a public GitHub repo + push, a Vercel deploy, and a ≤3 min English YouTube demo.
