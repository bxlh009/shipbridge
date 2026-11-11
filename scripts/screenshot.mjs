import fs from "fs";
import path from "path";
import { chromium } from "playwright";

const base = process.env.SHIPBRIDGE_URL || "http://127.0.0.1:3000";
const dir = path.resolve("screenshots");

async function enabled(page, testId) {
  await page.waitForFunction((id) => {
    const button = document.querySelector(`[data-testid="${id}"]`);
    return button instanceof HTMLButtonElement && !button.disabled;
  }, testId);
}

async function settledStat(page, testId, expected) {
  await page.waitForFunction(
    ({ testId, expected }) => {
      const el = document.querySelector(`[data-testid="${testId}"]`);
      if (!(el instanceof HTMLElement) || el.getAttribute("data-settled") !== "true") return false;
      if (expected == null) return true;
      return (el.textContent || "").trim() === expected;
    },
    { testId, expected },
    { timeout: 20000 },
  );
}

function moneyTarget(delta) {
  const match = delta.match(/→\s*(\$[\d,]+\.\d{2})/);
  return match ? match[1] : "";
}

async function stepDone(page, testId) {
  await page.waitForFunction((id) => document.querySelector(`[data-testid="${id}-mark"]`)?.getAttribute("data-state") === "done", testId);
}

async function shootSandbox(page) {
  await page.goto(base, { waitUntil: "networkidle" });
  await page.getByTestId("paypal-chip").filter({ hasText: /sandbox/i }).waitFor();
  await settledStat(page, "stat-orders", null);
  await enabled(page, "step-load");
  await page.getByTestId("step-load").click();
  await page.getByText(/manifest rows loaded|条发货记录已载入/).waitFor();
  await enabled(page, "step-match");
  await page.getByTestId("step-match").click();
  await page.getByText("Seller Protection requires shipping to the PayPal address").first().waitFor();
  await enabled(page, "step-sync");
  await page.getByTestId("step-sync").click();
  const errorBanner = page.getByTestId("error-banner");
  await Promise.race([
    page.getByText(/verified in PayPal/i).first().waitFor(),
    errorBanner.waitFor().then(async () => {
      throw new Error(await errorBanner.innerText());
    }),
  ]);
  await stepDone(page, "step-sync");
  const delta = page.getByTestId("delta-releasing");
  if (await delta.count()) {
    const text = (await delta.innerText()).replace(/\s+/g, " ");
    const target = moneyTarget(text);
    if (target) {
      await settledStat(page, "stat-releasing", target);
      const shown = (await page.getByTestId("stat-releasing").innerText()).trim();
      if (shown !== target) throw new Error(`Releasing early ${shown} disagrees with ${text}`);
    }
  } else {
    await settledStat(page, "stat-releasing", null);
  }
  const chipAfter = (await page.getByTestId("paypal-chip").innerText()).trim();
  if (!/sandbox/i.test(chipAfter)) throw new Error(`status chip is "${chipAfter}"`);
  await page.screenshot({ path: path.join(dir, "sandbox-synced.png"), fullPage: true });
  console.log("wrote screenshots/sandbox-synced.png");
}

async function main() {
  fs.mkdirSync(dir, { recursive: true });
  for (const stale of ["buyer-reply.png", "synced.png"]) fs.rmSync(path.join(dir, stale), { force: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(process.argv.includes("--sandbox") ? 180000 : 30000);
  if (process.argv.includes("--sandbox")) {
    await shootSandbox(page);
    await browser.close();
    return;
  }
  await page.goto(base, { waitUntil: "networkidle" });
  await page.getByTestId("hero-pitch").waitFor();
  await page.getByTestId("empty-state").waitFor();
  await settledStat(page, "stat-on-hold", "10");
  await page.getByTestId("hero").screenshot({ path: path.join(dir, "hero.png") });
  await page.screenshot({ path: path.join(dir, "home.png"), fullPage: true });

  await enabled(page, "step-load");
  await page.getByTestId("step-load").click();
  await page.getByText(/manifest rows loaded|条发货记录已载入/).waitFor();
  await stepDone(page, "step-load");
  await enabled(page, "step-match");
  await page.getByTestId("step-match").click();
  await page.getByText("YT202611110001").waitFor();
  await page.getByText("Seller Protection requires shipping to the PayPal address").first().waitFor();
  await stepDone(page, "step-match");
  await page.screenshot({ path: path.join(dir, "matched-grid.png"), fullPage: true });

  await enabled(page, "step-sync");
  await page.getByTestId("step-sync").click();
  await page.getByText(/verified in PayPal/i).first().waitFor();
  await page.getByTestId("toast").filter({ hasText: /verified in PayPal/i }).waitFor();
  await page.getByTestId("delta-on-hold").waitFor();
  await page.getByTestId("delta-releasing").waitFor();
  const releasingDelta = (await page.getByTestId("delta-releasing").innerText()).replace(/\s+/g, " ");
  const releasingTarget = moneyTarget(releasingDelta);
  await settledStat(page, "stat-on-hold", "2");
  await settledStat(page, "stat-releasing", releasingTarget);
  const releasingShown = (await page.getByTestId("stat-releasing").innerText()).trim();
  if (!releasingTarget || releasingShown !== releasingTarget) {
    throw new Error(`Releasing early ${releasingShown} disagrees with ${releasingDelta}`);
  }
  await stepDone(page, "step-sync");
  await page.screenshot({ path: path.join(dir, "after-sync.png"), fullPage: true });

  await page.getByTestId("buyer-message").click();
  await page.getByTestId("buyer-drawer").waitFor();
  await page.getByTestId("buyer-email").fill("Where is my order?? Order SB-1001. This is Emily Carter and I may open a dispute.");
  await page.getByTestId("draft-reply").click();
  await page.getByTestId("reply-output").getByText("YT202611110001").first().waitFor();
  await page.getByText("Chinese explanation").waitFor();
  await page.screenshot({ path: path.join(dir, "buyer-drawer.png") });

  await page.getByTestId("drawer-close").click();
  await page.getByTestId("lang-zh").click();
  await page.getByText("把承运商单号回传到 PayPal，让冻结资金更早解冻，未收到货争议也有物流凭证。").waitFor();
  await page.getByText("上传发货表").waitFor();
  await page.screenshot({ path: path.join(dir, "chinese.png"), fullPage: true });

  await browser.close();
  console.log("screenshots written to", dir);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
