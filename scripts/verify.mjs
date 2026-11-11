const base = process.env.SHIPBRIDGE_URL || "http://127.0.0.1:3000";

let failed = 0;

function pass(name) {
  console.log(`PASS ${name}`);
}

function fail(name, detail) {
  failed += 1;
  console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
}

async function request(pathname, options) {
  const response = await fetch(`${base}${pathname}`, options);
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  return { status: response.status, body };
}

async function main() {
  const health = await request("/api/health");
  if (health.status === 200 && health.body.ok && health.body.paypal === "mock" && health.body.ai === "off") pass("health");
  else fail("health", JSON.stringify(health.body));

  const seed = await request("/api/seed", { method: "POST" });
  if (seed.status === 200 && seed.body.ok && seed.body.orders?.length === 10) pass("seed reset");
  else fail("seed reset", `status ${seed.status}`);

  const orders = await request("/api/orders");
  const ids = (orders.body.orders || []).map((order) => order.id);
  if (orders.body.ok && ids.length === 10 && orders.body.stats?.simulated === true && orders.body.stats.onHoldCount >= 1) pass("orders");
  else fail("orders", `count ${ids.length} hold ${orders.body.stats?.onHoldCount}`);

  const parsed = await request("/api/parse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sample: "all" }),
  });
  const rows = parsed.body.rows || [];
  const trackings = new Set(rows.map((row) => row.trackingNumber));
  const emily = rows.find((row) => row.trackingNumber === "YT202611110001");
  if (
    parsed.body.ok &&
    rows.length === 10 &&
    trackings.has("YT202611110003") &&
    trackings.has("4PX202611110008") &&
    trackings.has("YW202611110006") &&
    emily?.country === "US"
  ) {
    pass("parse sample manifests");
  } else fail("parse sample manifests", `rows ${rows.length}`);

  const matched = await request("/api/match", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rows }),
  });
  const matchedRows = matched.body.rows || [];
  const anna = matchedRows.find((row) => row.recipientName === "Anna Schmidt");
  const typo = matchedRows.find((row) => row.recipientName === "Micheal Obrien");
  const noah = matchedRows.find((row) => row.recipientName === "Noah Bennett");
  const chloe = matchedRows.find((row) => row.recipientName === "Chloe Davis");
  if (
    anna?.addressRisk === true &&
    String(anna.addressWarning).includes("Seller Protection") &&
    typo?.matchedOrderId === "SB-1003" &&
    noah?.matchedOrderId == null &&
    chloe?.matchedOrderId === "SB-1008"
  ) {
    pass("match");
  } else fail("match", JSON.stringify({ anna: anna?.addressRisk, typo: typo?.matchedOrderId, noah: noah?.matchedOrderId, chloe: chloe?.matchedOrderId }));

  const synced = await request("/api/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rows: matchedRows.map((row) => ({ ...row, selected: false })) }),
  });
  const syncedRows = synced.body.rows || [];
  const emilySync = syncedRows.find((row) => row.trackingNumber === "YT202611110001");
  const annaSync = syncedRows.find((row) => row.recipientName === "Anna Schmidt");
  if (emilySync?.syncStatus === "verified" && String(emilySync.syncMessage).includes("verified in PayPal") && annaSync?.syncStatus === "skipped") {
    pass("sync");
  } else fail("sync", `emily ${emilySync?.syncStatus} anna ${annaSync?.syncStatus} ${annaSync?.syncMessage || ""}`);

  const readBack = await request("/api/orders");
  const emilyOrder = (readBack.body.orders || []).find((order) => order.id === "SB-1001");
  const numbers = (emilyOrder?.tracking || []).map((item) => item.trackingNumber);
  if (numbers.includes("YT202611110001") && emilyOrder.tracking.some((item) => item.verified)) pass("read-back");
  else fail("read-back", numbers.join(",") || "missing");

  const risky = await request("/api/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      rows: syncedRows.map((row) => ({ ...row, selected: row.recipientName === "Anna Schmidt" })),
    }),
  });
  const annaForced = (risky.body.rows || []).find((row) => row.recipientName === "Anna Schmidt");
  if (annaForced?.syncStatus === "verified") pass("sync explicit risk row");
  else fail("sync explicit risk row", annaForced?.syncStatus || "missing");

  const reply = await request("/api/buyer-reply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "Where is my order?? Order SB-1001. This is Emily Carter and I may open a dispute.",
    }),
  });
  const chinese = `${reply.body.chinese?.summary || ""}`;
  if (
    reply.body.ok &&
    reply.body.detectedOrderId === "SB-1001" &&
    reply.body.englishReply?.includes("YT202611110001") &&
    /[\u4e00-\u9fff]/.test(chinese) &&
    reply.body.source === "template"
  ) {
    pass("buyer-reply");
  } else fail("buyer-reply", JSON.stringify({ id: reply.body.detectedOrderId, source: reply.body.source, hasTrack: reply.body.englishReply?.includes("YT202611110001") }));

  const image = await request("/api/parse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      imageDataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    }),
  });
  if (image.body.code === "LLM_UNAVAILABLE" && /sample/i.test(image.body.message || "")) pass("screenshot without llm");
  else fail("screenshot without llm", image.body.message || image.status);

  const agent = await request("/api/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      instruction: "sync tracking for these rows",
      rows: matchedRows.filter((row) => row.trackingNumber === "YW202611110006").map((row) => ({ ...row, selected: true })),
    }),
  });
  if (agent.body.ok && /YW202611110006/.test(agent.body.text || "") && /mock|direct|deterministic/i.test(`${agent.body.engine} ${agent.body.toolkit}`)) {
    pass("agent deterministic");
  } else fail("agent deterministic", agent.body.engine || agent.body.message);

  if (failed) {
    console.log(`\n${failed} FAILED`);
    process.exit(1);
  }
  console.log("\nALL PASS");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
