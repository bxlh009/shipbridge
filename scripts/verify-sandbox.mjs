import fs from "fs";

const base = process.env.SHIPBRIDGE_URL || "http://127.0.0.1:3001";
const lines = [];
let failed = 0;

function log(line) {
  lines.push(line);
  console.log(line);
}

function pass(name) {
  log(`PASS ${name}`);
}

function fail(name, detail) {
  failed += 1;
  log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
}

async function request(pathname, options) {
  const response = await fetch(`${base}${pathname}`, options);
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 400) };
  }
  return { status: response.status, body };
}

function orderByInvoice(orders, invoiceId) {
  return (orders || []).find((order) => order.invoiceId === invoiceId);
}

async function main() {
  const health = await request("/api/health");
  if (health.status === 200 && health.body.ok && health.body.paypal === "sandbox") pass("health paypal=sandbox");
  else fail("health paypal=sandbox", `status ${health.status} paypal=${health.body?.paypal || "missing"}`);

  const listed = await request("/api/orders");
  const orders = listed.body.orders || [];
  if (!listed.body.ok) fail("list orders", `status ${listed.status}`);
  else pass(`list orders count=${orders.length}`);

  for (const order of orders) {
    const label = `${order.invoiceId || "no-invoice"} ${order.buyerName} ${order.postalCode} ${order.country} order=${order.id} capture=${order.captureId || "none"} status=${order.status}`;
    if (order.status === "COMPLETED" && order.captureId && order.id) pass(`order ${label}`);
    else fail(`order ${label}`);
  }

  const annaOrder = orderByInvoice(orders, "INV-1004");
  if (annaOrder && String(annaOrder.postalCode).replace(/\s/g, "") === "10115") pass("Anna Schmidt PayPal postcode 10115");
  else fail("Anna Schmidt PayPal postcode 10115", annaOrder ? `got ${annaOrder.postalCode}` : "order missing");

  const noah = orders.find((order) => /noah bennett/i.test(order.buyerName || ""));
  if (!noah) pass("Noah Bennett has no order");
  else fail("Noah Bennett has no order", noah.id);

  const parsed = await request("/api/parse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sample: "all" }),
  });
  const rows = parsed.body.rows || [];
  if (parsed.body.ok && rows.length === 10) pass("parse sample manifests");
  else fail("parse sample manifests", `rows ${rows.length}`);

  const matched = await request("/api/match", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rows }),
  });
  const matchedRows = matched.body.rows || [];
  const anna = matchedRows.find((row) => row.recipientName === "Anna Schmidt");
  const typo = matchedRows.find((row) => row.recipientName === "Micheal Obrien");
  const noahRow = matchedRows.find((row) => row.recipientName === "Noah Bennett");
  const chloe = matchedRows.find((row) => row.recipientName === "Chloe Davis");
  const typoOrder = orders.find((order) => order.id === typo?.matchedOrderId);
  const chloeOrder = orders.find((order) => order.id === chloe?.matchedOrderId);
  if (anna?.addressRisk === true && String(anna.addressWarning || "").includes("Seller Protection")) pass("Anna Schmidt flagged red");
  else fail("Anna Schmidt flagged red", `risk=${anna?.addressRisk} warning=${anna?.addressWarning || ""}`);
  if (typoOrder?.invoiceId === "INV-1003") pass("Micheal Obrien matches Michael O'Brien");
  else fail("Micheal Obrien matches Michael O'Brien", typoOrder?.invoiceId || typo?.matchedOrderId || "none");
  if (chloeOrder?.invoiceId === "INV-1008") pass("Chloe Davis matches Chloe Davies");
  else fail("Chloe Davis matches Chloe Davies", chloeOrder?.invoiceId || "none");
  if (noahRow && !noahRow.matchedOrderId) pass("Noah Bennett unmatched");
  else fail("Noah Bennett unmatched", noahRow?.matchedOrderId || "missing row");

  const synced = await request("/api/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rows: matchedRows.map((row) => ({ ...row, selected: false })) }),
  });
  const syncedRows = synced.body.rows || [];
  if (!synced.body.ok) fail("sync", `status ${synced.status} ${synced.body.message || ""}`);
  else pass("sync request");

  const annaSync = syncedRows.find((row) => row.recipientName === "Anna Schmidt");
  if (annaSync?.syncStatus === "skipped") pass("Anna Schmidt skipped by default");
  else fail("Anna Schmidt skipped by default", `${annaSync?.syncStatus || "missing"} ${annaSync?.syncMessage || ""}`);

  const carrierResults = synced.body.carrierResults || [];
  const seenCarriers = new Map();
  for (const result of carrierResults) {
    const key = result.requested || "unknown";
    const prev = seenCarriers.get(key) || { used: new Set(), fallback: false, rejection: "" };
    prev.used.add(result.used || "");
    if (result.fallback) prev.fallback = true;
    if (result.rejection) prev.rejection = result.rejection;
    seenCarriers.set(key, prev);
    const name = `${result.invoiceId} ${result.trackingNumber} requested=${result.requested} used=${result.used} via=${result.via}`;
    if (result.error) fail(`carrier ${name}`, result.error);
    else if (result.fallback) pass(`carrier fallback ${name} rejection=${result.rejection || "unspecified"}`);
    else pass(`carrier accepted ${name}`);
  }
  for (const [requested, info] of seenCarriers) {
    log(`CARRIER ${requested} used=${[...info.used].join("|") || "none"} fallback=${info.fallback ? "yes" : "no"}${info.rejection ? ` rejection=${info.rejection}` : ""}`);
  }

  const readBack = await request("/api/orders");
  const readOrders = readBack.body.orders || [];
  for (const row of syncedRows) {
    if (row.recipientName === "Anna Schmidt") continue;
    if (!row.matchedOrderId) {
      if (row.recipientName === "Noah Bennett") continue;
      fail(`read-back ${row.trackingNumber}`, "no matched order");
      continue;
    }
    const order = readOrders.find((item) => item.id === row.matchedOrderId);
    const numbers = (order?.tracking || []).map((item) => item.trackingNumber);
    if (row.syncStatus === "verified" && numbers.includes(row.trackingNumber)) pass(`read-back ${row.refNo} ${row.trackingNumber} on ${order.id}`);
    else fail(`read-back ${row.refNo} ${row.trackingNumber}`, `status=${row.syncStatus} onOrder=${numbers.join(",") || "none"} ${row.syncMessage || ""}`);
  }

  const annaAfter = readOrders.find((order) => order.invoiceId === "INV-1004");
  const annaNumbers = (annaAfter?.tracking || []).map((item) => item.trackingNumber);
  if (annaAfter && !annaNumbers.includes("YT202611110004")) pass("Anna Schmidt tracking not written");
  else fail("Anna Schmidt tracking not written", annaNumbers.join(",") || "order missing");

  if (failed) log(`FAIL ${failed} step(s)`);
  else log("ALL PASS");
}

main()
  .catch((error) => {
    failed += 1;
    log(`FAIL verify-sandbox — ${error instanceof Error ? error.message : String(error)}`);
  })
  .finally(() => {
    fs.writeFileSync(new URL("../sandbox-run.log", import.meta.url), `${lines.join("\n")}\n`);
    process.exit(failed ? 1 : 0);
  });
