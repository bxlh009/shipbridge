# ShipBridge — Devpost submission draft

Paste-ready English copy for https://paypalaihackathon.devpost.com/
Deadline: 2026-11-13 04:00 Asia/Shanghai (2026-11-12 12:00 PST).
Do not submit until the public GitHub repo, YouTube video, and (optional) hosted demo URL are filled in.

## Project name

ShipBridge

## Tagline (short)

A tracking desk that matches Chinese carrier manifests to PayPal orders, flags address risk, and writes tracking numbers back in bulk.

## Built with (check on the form)

- PayPal: Orders v2 `POST /v2/checkout/orders/{id}/track`, Shipping `POST /v1/shipping/trackers-batch`, and `@paypal/agent-toolkit` shipment tools in sandbox/live
- AI: optional OpenAI-compatible vision + match adjudication + buyer-reply brief; Vercel AI SDK agent tools. With no key, the same demo finishes on deterministic rules and templates
- AG Grid Community (Quartz) for the review grid — check Best Use of AG Grid
- Next.js, TypeScript, Tailwind

Leave APIMatic, Bryntum, Channel3, Elastic, Render, Zapier, Postman, KERNEL, and Astropods unchecked unless you actually used them in the submitted build.

## Text description

ShipBridge is a shipments desk for Chinese cross-border sellers who get paid on PayPal. After a batch ships with YunExpress, 4PX, or Yanwen, the seller drops in the carrier spreadsheet (CSV or XLSX, including Chinese headers) — or a screenshot, when an LLM key is set — and ShipBridge matches each row to a PayPal order, flags addresses that would break Seller Protection, and writes the tracking numbers back in bulk.

New PayPal sellers often wait up to 21 days for funds. Adding a valid tracking number, then waiting for the carrier to confirm delivery, is how PayPal can release many of those holds about a day after delivery. Shopify-only sync apps do not cover independent sites, social checkout, or invoice sellers, and English tooling rarely understands these Chinese warehouse exports. When the number never lands on the PayPal order, item-not-received disputes go up, funds sit in the hold, and support load grows on both sides.

The matcher is deterministic (name, postcode, country, item, invoice id), with optional LLM adjudication for mid-range scores. A mismatched postcode or country is marked before sync, because Seller Protection requires shipping only to the PayPal address. Risk rows sync only when the seller selects them. After a push, ShipBridge reads the order back and shows “Verified in PayPal” only when the tracking number is actually on the order.

The desk also drafts buyer replies: paste an English “where is my order” email, get a Chinese brief (mood, ask, dispute risk) and an English reply with carrier, tracking number, and a clearly labeled simulated timeline. An agent route exposes the same get-order and tracking tools through the Vercel AI SDK, and in sandbox or live mode those names are filled by PayPal’s Agent Toolkit when the package loads.

A mock mode ships with ten fake SAMPLE orders and sample manifests so judges can run the full path without credentials: Load sample → Run matching → Push tracking. Sandbox mode uses real PayPal REST against seeded sandbox captures. Holds and “days released earlier” are labeled Simulated, because the PayPal sandbox does not place real 21-day holds. No real customer data is included.

Complete setup and run instructions are in the repository README, including a 2.5-minute demo script. MIT licensed.

## How PayPal is used

- Orders v2 tracking: `POST /v2/checkout/orders/{id}/track` is the primary write
- Fallback: `POST /v1/shipping/trackers-batch`
- Read-back of the order to confirm the tracking number is present before the UI shows verified
- Sandbox seed script creates COMPLETED card captures and lists them through `GET /v2/checkout/orders/{id}`
- `@paypal/agent-toolkit` (`PayPalAgentToolkit` for the AI SDK) supplies `get_order`, `create_shipment_tracking`, and `get_shipment_tracking` in sandbox/live when the package loads; a direct client is the fallback
- Sync calls use `notify_payer: false`

## How AI is used

- Optional vision model to parse a manifest screenshot
- Optional LLM adjudication for ambiguous (score 40–80) matches
- Buyer-reply: Chinese explanation plus an English draft
- Agent mode: Vercel AI SDK tools that wrap the PayPal tracking flow
- If no LLM key is set, spreadsheets, deterministic matching, and reply templates still complete the demo. Please note this in the video: the mock run can show “AI off · rules”

## Demo video notes

Keep it under 3 minutes, in English (or English subtitles), no copyrighted music, show the app actually running, upload to YouTube as public.

Follow README section “Demo script (about 2.5 minutes)”: problem and audience, open the mock desk, load the sample manifest, run matching (including the postcode mismatch), push tracking and show verified read-back, open a buyer reply, close on the PayPal outcome.

YouTube transcoding can take hours. Upload early. After the deadline, do not change the repo, README, or video until results are announced around 2026-12-21.

## Links to fill in later

- Public repo: (create `https://github.com/bxlh009/shipbridge`, MIT license file at the repo root so GitHub detects it in About)
- Hosted demo URL: (optional if README run instructions are complete; a public Vercel deploy still helps judges)
- YouTube URL: (public, under 3 minutes)

## After you enter the submission

The form can be edited until the deadline. Confirm the license is visible in the repo About section, no secrets are in the repo, and AG Grid is checked if the submitted grid still uses it.
