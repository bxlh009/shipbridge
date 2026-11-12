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
  const aiOff = health.body.ai === "off";
  const aiOn = Boolean(health.body.model) && health.body.ai !== "off";
  if (health.status === 200 && health.body.ok && health.body.paypal === "mock" && (aiOff || aiOn)) {
    pass(aiOn ? `health (ai ${health.body.model})` : "health");
  } else fail("health", JSON.stringify(health.body));

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

  let ordersState = seed.body.orders;

  const matched = await request("/api/match", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rows, orders: ordersState }),
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
    body: JSON.stringify({ rows: matchedRows.map((row) => ({ ...row, selected: false })), orders: ordersState }),
  });
  const syncedRows = synced.body.rows || [];
  const emilySync = syncedRows.find((row) => row.trackingNumber === "YT202611110001");
  const annaSync = syncedRows.find((row) => row.recipientName === "Anna Schmidt");
  if (emilySync?.syncStatus === "verified" && String(emilySync.syncMessage).includes("verified in PayPal") && annaSync?.syncStatus === "skipped" && synced.body.orders?.length === 10) {
    pass("sync");
  } else fail("sync", `emily ${emilySync?.syncStatus} anna ${annaSync?.syncStatus} ${annaSync?.syncMessage || ""}`);
  ordersState = synced.body.orders || ordersState;

  const memory = await request("/api/orders");
  const memoryEmily = (memory.body.orders || []).find((order) => order.id === "SB-1001");
  const memoryNumbers = (memoryEmily?.tracking || []).map((item) => item.trackingNumber);
  if (memory.status === 200 && memory.body.source === "catalog" && !memoryNumbers.includes("YT202611110001")) pass("mock stateless");
  else fail("mock stateless", memoryNumbers.join(",") || "server kept tracking");

  const readBack = await request("/api/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orders: ordersState, readBack: { orderId: "SB-1001", trackingNumber: "YT202611110001" } }),
  });
  const missing = await request("/api/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orders: ordersState, readBack: { orderId: "SB-1001", trackingNumber: "NOT-ON-THE-ORDER" } }),
  });
  const spoof = (ordersState || []).map((order) =>
    order.id === "SB-1001"
      ? { ...order, tracking: [{ trackingNumber: "SPOOF", carrier: "YUNEXPRESS", status: "SHIPPED", verified: true }] }
      : order,
  );
  const spoofed = await request("/api/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orders: spoof, readBack: { orderId: "SB-1001", trackingNumber: "YT202611110001" } }),
  });
  const emilyOrder = (readBack.body.orders || []).find((order) => order.id === "SB-1001");
  const numbers = (emilyOrder?.tracking || []).map((item) => item.trackingNumber);
  if (
    numbers.includes("YT202611110001") &&
    emilyOrder.tracking.some((item) => item.verified) &&
    readBack.body.readBack?.verified === true &&
    missing.body.readBack?.verified === false &&
    spoofed.body.readBack?.verified === false
  ) {
    pass("read-back");
  } else {
    fail("read-back", JSON.stringify({ numbers, verified: readBack.body.readBack, missing: missing.body.readBack, spoofed: spoofed.body.readBack }));
  }

  const risky = await request("/api/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      rows: syncedRows.map((row) => ({ ...row, selected: row.recipientName === "Anna Schmidt" })),
      orders: ordersState,
    }),
  });
  const annaForced = (risky.body.rows || []).find((row) => row.recipientName === "Anna Schmidt");
  if (annaForced?.syncStatus === "verified") pass("sync explicit risk row");
  else fail("sync explicit risk row", annaForced?.syncStatus || "missing");
  ordersState = risky.body.orders || ordersState;

  const reply = await request("/api/buyer-reply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "Where is my order?? Order SB-1001. This is Emily Carter and I may open a dispute.",
      orders: ordersState,
    }),
  });
  const chinese = `${reply.body.chinese?.summary || ""}`;
  if (
    reply.body.ok &&
    reply.body.detectedOrderId === "SB-1001" &&
    reply.body.englishReply?.includes("YT202611110001") &&
    /[\u4e00-\u9fff]/.test(chinese) &&
    (reply.body.source === "template" || reply.body.source === "llm")
  ) {
    pass(reply.body.source === "llm" ? "buyer-reply (llm)" : "buyer-reply");
  } else fail("buyer-reply", JSON.stringify({ id: reply.body.detectedOrderId, source: reply.body.source, hasTrack: reply.body.englishReply?.includes("YT202611110001") }));

  const image = await request("/api/parse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      imageDataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    }),
  });
  if (image.body.code === "LLM_UNAVAILABLE" && /sample/i.test(image.body.message || "")) pass("screenshot without llm");
  else if (image.body.code === "VISION_FAILED" && /sample/i.test(image.body.message || "")) pass("screenshot vision fallback");
  else if (image.body.ok && image.body.source === "screenshot") pass("screenshot with llm");
  else fail("screenshot", image.body.message || image.body.code || image.status);

  const agent = await request("/api/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      instruction: "sync tracking for these rows",
      rows: matchedRows.filter((row) => row.trackingNumber === "YW202611110006").map((row) => ({ ...row, selected: true })),
      orders: ordersState,
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
