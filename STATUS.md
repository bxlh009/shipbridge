# ShipBridge status

Updated 2026-11-12 after the token-and-waybill visual pass (mock and sandbox).

## Built

- Next.js App Router + TypeScript + Tailwind UI. Dense shipments desk: left nav, merchant bar, environment pill, EN / 中文 toggle, four KPI tiles, inline stepper, AG Grid quartz (v33 Theming API), buyer drawer, empty state, and toasts. Page background `#F6F7F9`, 1px gray borders, 6px radius, PayPal blue `#0070E0` only on actions and the current step.
- Page title “Shipments” with one operational subtitle. Guided demo stays Load sample → Match → Push tracking. The current step is accent, finished steps show a check. Both languages.
- Manifest parser for YunExpress, 4PX, and Yanwen CSV/XLSX, including Chinese headers. Screenshot path calls an OpenAI-compatible vision chat and, with no key, returns `LLM_UNAVAILABLE` plus the sample list.
- SAMPLE files in `public/samples/`: `yunexpress-sample.csv`, `4px-sample.xlsx`, `yanwen-sample.csv`. Buyers are fake. They line up with mock orders SB-1001–SB-1009. Noah Bennett has no order. Anna Schmidt’s postcode 10117 does not match PayPal 10115. Micheal Obrien and Chloe Davis are name variants.
- Deterministic matcher (name, postcode, country, item, invoice id) and optional LLM adjudication that fails soft.
- AG Grid Community review grid (themeQuartz, 13px, row height 36) with checkbox selection, confidence number plus a thin bar, status pills, override dropdown, and green “Verified in PayPal” only after read-back. A mismatched postcode or country cell uses `#FEF2F2` plus a tooltip. The risk row has one red bar on the left selection column, not a full-row red fill. PayPal order ids longer than 12 characters render as the invoice id (tooltip keeps the PayPal id).
- Sync via Orders v2 `POST /v2/checkout/orders/{id}/track`, fallback `POST /v1/shipping/trackers-batch`. Carrier map in `lib/carriers.ts` (`YUNEXPRESS`, `FOUR_PX_EXPRESS`, `YANWEN`, `CN_CHINA_POST_EMS`, `DHL`, `UPS`, `FEDEX`, `USPS`, otherwise `OTHER`).
- Mock mode is stateless on the server. Orders are seeded from the fixed catalog. The browser keeps orders and trackers in `localStorage`. Sync and read-back send that state and get the next copy back. Read-back is true only when the tracking number is on the returned order. **Reset demo** clears `localStorage`. Sandbox and live mode stay on server-side REST.
- After a verified sync, payments on hold count down and “Releasing early” counts up, with a short green tint. Sample run: 10 → 2 on hold, $0.00 → $206.79 releasing early, 7.5 days earlier. “Simulated” is a muted tag. Disputes avoided (est.) is the synced count. Tracking coverage is synced/total.
- Sandbox seed (`scripts/seed-sandbox.ts`) creates COMPLETED captures with `payment_source.card` and `PayPal-Request-Id`. The gitignored registry `.data/sandbox-orders.json` is what `GET /api/orders` lists, via `GET /v2/checkout/orders/{id}`. Transaction Search is not used. `scripts/capture.ts` finishes any order that still needs a buyer approval.
- Buyer reply opens a 480px right drawer: order header, pasted email, Chinese explanation (source “Rules” when AI is off), English draft with Copy, and a vertical timeline. Esc or X closes it. Sync results use a small bottom-right toast.
- `POST /api/agent`: Vercel AI SDK tools. In sandbox/live, `@paypal/agent-toolkit` `PayPalAgentToolkit` tools are registered when the package loads. Mock mode and toolkit failures use the direct client against the orders sent with the request. No LLM key runs the same sync deterministically.
- `GET /api/health`, vitest tests, `scripts/verify.mjs`, `scripts/screenshot.mjs`.

## Verification

- `npm test`: 10 tests passed (manifest parsing, carrier mapping, typo match, postcode mismatch flag, stateless mock sync, read-back that ignores a lying `verified` flag, carrier-rejection detection).
- `npx next build`: passed (Next.js 15.5.29). `next build` loads `.env.local` but does not inline the server credentials into the client bundle.
- Env precedence: `@next/env` `loadEnvConfig` keeps a process-environment value and fills only missing keys from `.env.local`, which beats `.env`. Confirmed on the running app: `PAYPAL_MODE=mock npm run start` with a sandbox `.env.local` returned `GET /api/health` `paypal=mock`. `npm run start` with no shell `PAYPAL_MODE` returned `paypal=sandbox`.
- `PAYPAL_MODE=mock npm run start` on port 3000, then `node scripts/verify.mjs`: **ALL PASS**
  - health, seed reset, orders, parse sample manifests, match, sync, mock stateless (GET /api/orders does not remember the tracker), read-back (number present, missing number false, spoofed `verified: true` without the number is false), explicit risk-row sync, buyer-reply, screenshot without LLM, agent deterministic.
- `node scripts/screenshot.mjs` at 1440×900: `screenshots/home.png`, `hero.png`, `matched-grid.png`, `after-sync.png`, `buyer-drawer.png`, `chinese.png`. Obsolete `buyer-reply.png` and `synced.png` are removed by the script. The after-sync shot waits until the count-up sets `data-settled="true"`. Releasing early is `$206.79`, matching `$0.00 → $206.79`. Payments on hold show `10 → 2`. The toast reads “8 tracking numbers verified in PayPal” and “1 skipped (address mismatch)”.

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
- Re-push is idempotent. The latest verify treated tracking already on the order as success after read-back (`via=read_back`) for `YUNEXPRESS`, `FOUR_PX_EXPRESS`, and `YANWEN`. Requested and used carrier codes matched. No trackers-batch fallback.
- Read-back found each tracking number on `GET /v2/checkout/orders/{id}` (`purchase_units[].shipping.trackers`). Anna’s number `YT202611110004` was not written.
- `screenshots/sandbox-synced.png`: environment pill `Sandbox`, 8 verified, Anna’s row skipped with the postcode cell highlighted, Noah “No match”, releasing early `$206.79`, 2 still on hold (`$36.50`, Anna plus Ava). The Order column shows `INV-1001` style labels. There is no `10 → 2` delta on this shot because those orders were already tracked when the page loaded. Sandbox “days released earlier” is 10.9 because `paidAt` is the PayPal create date (11 Nov 2026) while the catalog ship dates are earlier. The mock catalog’s paid dates sit closer to the ship dates, so that demo still averages 7.5.

GET order is retried on HTTP 429 and 5xx. A single dropped id during sync is fetched again before the row is marked missing.

## Visual pass (2026-11-12)

Tokens live in `app/globals.css` (`@theme` plus `:root`): cool blue-tinted neutrals, accent `#0070E0`, brand `#003087`, radius 4/6, spacing 4/8/12/16/24/32, type 12/13/14/20/24. The signature is the waybill chip (`components/Waybill.tsx`): ui-monospace, tabular, dashed border, copy-on-click, “Copied” for under a second. Tracking numbers and order ids use it in the grid and the buyer drawer.

`components/Logo.tsx` is an inline parcel whose top edge is an arrow, solid `#003087`, with a semibold ShipBridge wordmark. The same paths are `app/icon.svg`. Sidebar, toolbar, drawer, and toasts use lucide-react at 16px, stroke 1.75. The primary button shows `Pushing {done}/{total}` while a sync is in flight. Matching shows the parcel-block loader over skeleton rows. EN / 中文 is a segmented control with a 200ms thumb. The grid search shakes 2px when nothing matches. Tracking coverage has a 3px bar. The drawer timeline is a vertical scan line with dots. `prefers-reduced-motion` turns the motion off.

## Verification (this pass)

- `npm test`: 10 passed.
- `npx next build`: passed (Next.js 15.5.29). `app/icon.svg` is emitted.
- `PAYPAL_MODE=mock npm run start` on port 3000, then `node scripts/verify.mjs`: **ALL PASS**.
- `npm run start -- -p 3001` (no shell `PAYPAL_MODE`; health `paypal=sandbox`), then `SHIPBRIDGE_URL=http://127.0.0.1:3001 node scripts/verify-sandbox.mjs`: **ALL PASS**. Re-push stayed on read-back for `YUNEXPRESS`, `FOUR_PX_EXPRESS`, and `YANWEN`. Anna Schmidt’s number was not written.
- Screenshots refreshed at 1440×900: `home.png`, `hero.png`, `matched-grid.png`, `after-sync.png`, `buyer-drawer.png`, `chinese.png`, `sandbox-synced.png`.

## Design review (round 1)

Opened the seven PNGs after the first token pass.

- Rule 13: the Country header rendered as “Cou”, Override sat under the pinned action column, and “Micheal Obrien” / “James Whitaker” ellipsized. Column widths were wider than the 1440 grid.
- Rule 14: the first mark read as a flag at 22px. The body was mostly the arrow.
- Rule 9: the drawer’s scan line was below the 900px fold, and the verified-row flash restarted when the locale changed, so `chinese.png` stayed green.

## Design review (round 2)

Fixed those three and re-shot.

- Country, Override, and the sample name variants are fully visible in English and 中文. Postcode `10117` and Address “Mismatch” stay on `#FEF2F2`. The risk bar is only on the pinned selection edge. Empty cells use “–”. Order ids in sandbox render as `INV-1001` waybill chips.
- The mark is a rectangle with the top edge extended into an arrow, `#003087`, plus the semibold wordmark. Favicon matches.
- The drawer shows the vertical scan line and the first dots at 1440×900. The English draft scrolls inside its own box so that line stays on screen. The verified flash runs once after sync, not on every locale render.
- KPI labels are sentence case. One filled accent button on the shipments view (the empty state owns it before a manifest; Push tracking owns it after). The coverage tile has the thin bar. Sandbox pill reads Sandbox, releasing early `$206.79`, 2 still on hold, 8/10 synced.

Left on purpose:

- The drawer covers the right KPI tiles. The timeline’s later dots continue under the fold; the first scans are on screen.
- The sync toast sits over the last grid row so the verified count stays visible.
- Under a 10-row grid the card still fills the viewport.
- 中文 keeps Mock / Sandbox in English. Noto Sans CJK SC is installed on this machine; fonts are not committed.
- No purple gradients, glass, emoji, sparkle icons, uppercase eyebrows, or 01/02/03 section numbers. Stepper circles are the only numbered marks.

## Earlier ops-desk review

Reviewed the seven PNGs at 1440×900 after one fix round, before the waybill pass.

Fixed in that round:

- The risk row drew two red bars (pinned selection column and the center row). Only the left selection column keeps the 3px bar. Postcode `10117` and Address “Mismatch” stay on `#FEF2F2`.
- The sync toast wrapped after the digit in “· 1”. It now breaks on the middot, so the two clauses are separate lines.
- The drawer labeled the rules draft “Template”. It now says “Rules” / “规则”.
- Sandbox PayPal order ids (~17 characters) were truncated in the Order and Override columns. Those cells show the invoice id when the PayPal id is longer than 12 characters. The full id stays on the tooltip.

Left on purpose:

- The drawer is a slide-over, so it covers the right KPI tiles and the right side of the grid. The overlay is a light scrim. The timeline starts on screen and continues below the 900px fold.
- Under a 10-row grid the card still fills the viewport, so there is empty surface below the last row. The same region is the empty state before upload.
- 中文 mode keeps the environment words Mock / Sandbox in English. CJK labels in the nav, KPIs, stepper, and grid are not clipped. Noto Sans CJK SC is installed on this machine; fonts are not committed.
- “Micheal Obrien” next to “Michael O'Brien” is the sample name variant, not a clipped cell.
- No purple gradients, glass, emoji, or marketing hero remain. The primary button is the only strong blue.

## Not verified

- No LLM key, so vision parsing and LLM adjudication were not called against a model. The no-key paths were verified.
- `public/samples/manifest-screenshot-SAMPLE.png` is a rendered fake YunExpress grid for the screenshot upload demo. Vision parsing was not called because no LLM key is set.
- Live (`PAYPAL_ENV=live`) was not called.

## TODOs

- Point `LLM_BASE_URL`, `LLM_API_KEY`, and `LLM_MODEL` at an OpenAI-compatible model and retry a manifest screenshot plus an ambiguous-row explanation.
- Carrier delivery webhooks and an item-not-received evidence pack.
- Hackathon deliverables that still need the user: a public GitHub repo + push, a Vercel deploy, and a ≤3 min English YouTube demo.
