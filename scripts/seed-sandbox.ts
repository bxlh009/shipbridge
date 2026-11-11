import fs from "fs";
import path from "path";
import { CATALOG } from "../lib/paypal/catalog";
import { loadLocalEnv } from "../lib/paypal/load-env";
import { paypalMode } from "../lib/paypal/mode";
import { redact } from "../lib/paypal/redact";
import {
  bumpSandboxAttempt,
  captureSandboxOrder,
  confirmCard,
  createCardOrder,
  createSandboxOrder,
  fetchPaypalOrderPayload,
  readSandboxRegistry,
  sandboxAttempt,
  upsertSandboxRecord,
  type CreatedOrder,
  type SandboxOrderRecord,
} from "../lib/paypal/rest";
import type { Order } from "../lib/types";

loadLocalEnv();

const TEST_CARDS = ["4032039317984658", "4012000033330026", "4005519200000004", "4012888888881881"];
const STATUS_PATH = path.join(process.cwd(), "STATUS.md");
const SECTION = "## Browser approvals needed";

type Recipe = { number: string; billing: "us" | "shipping" };

type Approval = { invoiceId: string; buyer: string; orderId: string; approveUrl: string; reason: string };

function last4(number: string): string {
  return number.slice(-4);
}

function recordFrom(template: Order, order: CreatedOrder): SandboxOrderRecord {
  return {
    sampleRef: template.id,
    invoiceId: template.invoiceId,
    orderId: order.id,
    captureId: order.captureId,
    status: order.status,
    buyer: template.buyerName,
    address: {
      line1: template.addressLine1,
      city: template.city,
      adminArea1: template.adminArea1,
      postalCode: template.postalCode,
      country: template.country,
    },
    approveUrl: order.approveUrl || undefined,
  };
}

function requestKey(invoiceId: string, tag: string): string {
  return `${invoiceId}:${tag}`;
}

function requestId(invoiceId: string, tag: string): string {
  const generation = sandboxAttempt(requestKey(invoiceId, tag));
  return `sb-${invoiceId}-${tag}-g${generation}`.slice(0, 108);
}

function failKey(invoiceId: string, tag: string) {
  bumpSandboxAttempt(requestKey(invoiceId, tag));
}

async function finishCapture(template: Order, order: CreatedOrder, tag: string): Promise<{ ok: boolean; order: CreatedOrder; error: string }> {
  if (order.status === "COMPLETED" && order.captureId) return { ok: true, order, error: "" };
  if (!order.id) return { ok: false, order, error: "PayPal did not return an order id" };
  if (order.status === "PAYER_ACTION_REQUIRED") return { ok: false, order, error: "PAYER_ACTION_REQUIRED" };
  const captured = await captureSandboxOrder(order.id, requestId(template.invoiceId, `cap-${tag}`));
  if (captured.ok && (captured.order.status === "COMPLETED" || captured.order.captureId)) {
    const status = captured.order.status || "COMPLETED";
    return { ok: status === "COMPLETED" || Boolean(captured.order.captureId), order: { ...captured.order, id: captured.order.id || order.id, status }, error: captured.error };
  }
  const again = await fetchPaypalOrderPayload(order.id);
  const existing = again.ok ? captureFromPayload(again.payload, order.id) : order;
  if (existing.status === "COMPLETED" && existing.captureId) return { ok: true, order: existing, error: "" };
  if (!captured.ok) failKey(template.invoiceId, `cap-${tag}`);
  return { ok: false, order: existing.id ? existing : order, error: captured.error || existing.status || "capture failed" };
}

function captureFromPayload(payload: { id?: string; status?: string; links?: { href: string; rel: string }[]; purchase_units?: CreatedOrder["payload"]["purchase_units"] }, fallbackId: string): CreatedOrder {
  const captures = payload.purchase_units?.[0]?.payments?.captures || [];
  const captureId = captures.find((item) => item.status === "COMPLETED")?.id || captures[0]?.id || "";
  const link = payload.links?.find((item) => item.rel === "payer-action" || item.rel === "approve");
  return {
    id: payload.id || fallbackId,
    status: payload.status || "",
    captureId,
    approveUrl: link?.href || (payload.id ? `https://www.sandbox.paypal.com/checkoutnow?token=${payload.id}` : ""),
    payload,
  };
}

async function tryRecipe(template: Order, recipe: Recipe): Promise<{ ok: boolean; order: CreatedOrder; error: string; created: boolean }> {
  const tag = `${last4(recipe.number)}-${recipe.billing}`;
  const created = await createCardOrder(template, recipe.number, recipe.billing, requestId(template.invoiceId, tag));
  if (!created.ok || !created.order.id) {
    failKey(template.invoiceId, tag);
    const duplicate = /DUPLICATE_INVOICE_ID|INVOICE_ID_ALREADY|already been used/i.test(created.error);
    return { ok: false, order: created.order, error: created.error || `create failed (${created.status})`, created: duplicate };
  }
  if (created.order.status === "PAYER_ACTION_REQUIRED") {
    return { ok: false, order: created.order, error: "PAYER_ACTION_REQUIRED", created: true };
  }
  const finished = await finishCapture(template, created.order, tag);
  return { ...finished, created: true };
}

async function tryConfirm(template: Order, orderId: string, recipe: Recipe): Promise<{ ok: boolean; order: CreatedOrder; error: string }> {
  const tag = `confirm-${last4(recipe.number)}-${recipe.billing}`;
  const confirmed = await confirmCard(orderId, template, recipe.number, recipe.billing, requestId(template.invoiceId, tag));
  if (!confirmed.ok) {
    failKey(template.invoiceId, tag);
    return { ok: false, order: { ...confirmed.order, id: orderId }, error: confirmed.error || "confirm-payment-source failed" };
  }
  const order = { ...confirmed.order, id: confirmed.order.id || orderId };
  if (order.status === "PAYER_ACTION_REQUIRED") return { ok: false, order, error: "PAYER_ACTION_REQUIRED" };
  return finishCapture(template, order, tag);
}

function cardDisabled(error: string): boolean {
  return /NOT_ENABLED|PERMISSION_DENIED|PAYEE_NOT_ENABLED|CARD_TYPE_NOT_SUPPORTED|UNPROCESSABLE_ENTITY.*card processing|not enabled for card/i.test(error);
}

async function seedOne(template: Order, preferred: Recipe | null): Promise<{ record?: SandboxOrderRecord; approval?: Approval; recipe: Recipe | null; disabled: boolean }> {
  const existing = readSandboxRegistry().orders.find((order) => order.invoiceId === template.invoiceId);
  if (existing?.orderId && existing.captureId && existing.status === "COMPLETED") {
    console.log(`SKIP ${template.invoiceId}  ${template.buyerName}  order=${existing.orderId} capture=${existing.captureId}`);
    return { record: existing, recipe: preferred, disabled: false };
  }

  if (existing?.orderId && !existing.captureId) {
    const captured = await finishCapture(template, {
      id: existing.orderId,
      status: existing.status,
      captureId: "",
      approveUrl: existing.approveUrl || "",
      payload: { id: existing.orderId },
    }, "existing");
    if (captured.ok) {
      const record = recordFrom(template, captured.order);
      upsertSandboxRecord(record);
      console.log(`PASS ${template.invoiceId}  ${template.buyerName}  order=${record.orderId} capture=${record.captureId}  reused`);
      return { record, recipe: preferred, disabled: false };
    }
  }

  const recipes: Recipe[] = [];
  if (preferred) recipes.push(preferred);
  for (const number of TEST_CARDS) {
    for (const billing of ["us", "shipping"] as const) {
      if (!recipes.some((recipe) => recipe.number === number && recipe.billing === billing)) recipes.push({ number, billing });
    }
  }

  let lastError = "";
  let openOrder: CreatedOrder | null = existing?.orderId
    ? { id: existing.orderId, status: existing.status, captureId: existing.captureId, approveUrl: existing.approveUrl || "", payload: { id: existing.orderId } }
    : null;
  let disabled = false;

  for (const recipe of recipes) {
    if (openOrder?.id && openOrder.status !== "COMPLETED") {
      const confirmed = await tryConfirm(template, openOrder.id, recipe);
      lastError = confirmed.error;
      if (confirmed.order.id) openOrder = confirmed.order;
      if (confirmed.ok && confirmed.order.captureId) {
        const record = recordFrom(template, confirmed.order);
        upsertSandboxRecord(record);
        console.log(`PASS ${template.invoiceId}  ${template.buyerName}  ${template.postalCode} ${template.country}  order=${record.orderId} capture=${record.captureId}  card=****${last4(recipe.number)} billing=${recipe.billing}`);
        return { record, recipe, disabled: false };
      }
      if (cardDisabled(confirmed.error)) {
        disabled = true;
        break;
      }
      if (confirmed.error === "PAYER_ACTION_REQUIRED") break;
      continue;
    }

    const attempt = await tryRecipe(template, recipe);
    lastError = attempt.error;
    if (attempt.order.id) openOrder = attempt.order;
    if (attempt.ok && attempt.order.captureId) {
      const record = recordFrom(template, attempt.order);
      upsertSandboxRecord(record);
      console.log(`PASS ${template.invoiceId}  ${template.buyerName}  ${template.postalCode} ${template.country}  order=${record.orderId} capture=${record.captureId}  card=****${last4(recipe.number)} billing=${recipe.billing}`);
      return { record, recipe, disabled: false };
    }
    if (cardDisabled(attempt.error)) {
      disabled = true;
      break;
    }
    if (attempt.created && attempt.order.id) {
      const partial = recordFrom(template, attempt.order);
      upsertSandboxRecord(partial);
      if (attempt.error === "PAYER_ACTION_REQUIRED") break;
    }
    if (attempt.created && /DUPLICATE_INVOICE_ID/i.test(attempt.error)) break;
  }

  if (!openOrder?.id) {
    try {
      const wallet = await createSandboxOrder(template, requestId(template.invoiceId, "wallet"));
      openOrder = wallet;
      const partial = recordFrom(template, wallet);
      upsertSandboxRecord(partial);
      lastError = lastError || "card capture unavailable";
    } catch (error) {
      lastError = redact(error instanceof Error ? error.message : String(error));
    }
  }

  if (openOrder?.id) {
    const partial = recordFrom(template, openOrder);
    upsertSandboxRecord(partial);
    console.log(`APPROVAL ${template.invoiceId}  ${template.buyerName}  order=${openOrder.id}`);
    console.log(`  approve: ${openOrder.approveUrl}`);
    return {
      recipe: preferred,
      disabled,
      approval: {
        invoiceId: template.invoiceId,
        buyer: template.buyerName,
        orderId: openOrder.id,
        approveUrl: openOrder.approveUrl,
        reason: redact(lastError || "capture incomplete"),
      },
    };
  }

  console.log(`FAIL ${template.invoiceId}  ${template.buyerName}  ${redact(lastError || "no order id")}`);
  return { recipe: preferred, disabled };
}

function writeApprovals(approvals: Approval[]) {
  const current = fs.existsSync(STATUS_PATH) ? fs.readFileSync(STATUS_PATH, "utf8") : "";
  const without = current.replace(/\n## Browser approvals needed[\s\S]*?(?=\n## |$)/, "").trimEnd() + "\n";
  if (!approvals.length) {
    if (current.includes(SECTION)) fs.writeFileSync(STATUS_PATH, without);
    return;
  }
  const lines = [
    SECTION,
    "",
    "Card capture did not finish for every order. Log in as the sandbox personal buyer and approve these links, then run `npx tsx scripts/capture.ts` with the order ids. Links are PayPal approval URLs, not credentials.",
    "",
    ...approvals.map((item) => `- ${item.invoiceId} ${item.buyer} order \`${item.orderId}\` — ${item.reason}`),
    ...approvals.map((item) => `  - ${item.approveUrl}`),
    "",
  ];
  fs.writeFileSync(STATUS_PATH, `${without}\n${lines.join("\n")}`);
}

async function main() {
  if (paypalMode() === "mock") {
    console.log("PAYPAL_MODE=mock (or credentials are missing). Process env overrides .env.local.");
    console.log("Mock orders come from the fixed catalog. The browser keeps tracking in localStorage:");
    for (const order of CATALOG) {
      console.log(`  ${order.id}  ${order.buyerName}  ${order.postalCode} ${order.country}  ${order.invoiceId}`);
    }
    console.log("Unset PAYPAL_MODE=mock and provide PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET to create sandbox orders.");
    return;
  }
  if (paypalMode() !== "sandbox") {
    console.error(`Refusing to seed while PayPal mode is ${paypalMode()}.`);
    process.exit(1);
  }

  const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.split("=")[1]) : CATALOG.length;
  const templates = CATALOG.slice(0, Number.isFinite(limit) && limit > 0 ? limit : CATALOG.length);
  console.log(`Seeding ${templates.length} sandbox orders with test cards (intent CAPTURE, USD).`);
  let preferred: Recipe | null = null;
  const approvals: Approval[] = [];
  let captured = 0;
  for (const template of templates) {
    try {
      const result = await seedOne(template, preferred);
      if (result.recipe) preferred = result.recipe;
      if (result.record?.captureId && result.record.status === "COMPLETED") captured += 1;
      if (result.approval) approvals.push(result.approval);
      if (result.disabled && !result.record) {
        console.log("Card processing is not available for this app. Remaining orders use approve links.");
      }
    } catch (error) {
      console.log(`FAIL ${template.invoiceId}  ${redact(error instanceof Error ? error.message : String(error))}`);
    }
  }
  writeApprovals(approvals);
  console.log(`Done. Completed captures: ${captured}. Approve links: ${approvals.length}. Registry: .data/sandbox-orders.json`);
  if (approvals.length) process.exitCode = 2;
}

main().catch((error) => {
  console.error(redact(error instanceof Error ? error.message : String(error)));
  process.exit(1);
});
