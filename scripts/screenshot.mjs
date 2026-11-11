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

async function shootSandbox(page) {
  await page.goto(base, { waitUntil: "networkidle" });
  await page.getByTestId("paypal-chip").waitFor();
  const chip = (await page.getByTestId("paypal-chip").innerText()).trim();
  if (!/sandbox/i.test(chip)) throw new Error(`status chip is "${chip}"`);
  await settledStat(page, "stat-orders", null);
  await enabled(page, "step-load");
  await page.getByTestId("step-load").click();
  await page.getByText(/manifest rows loaded|条发货记录已载入/).waitFor();
  await enabled(page, "step-match");
  await page.getByTestId("step-match").click();
  await page.getByText("Seller Protection risk: ship only to PayPal address").first().waitFor();
  await enabled(page, "step-sync");
  await page.getByTestId("step-sync").click();
  const errorBanner = page.getByTestId("error-banner");
  await Promise.race([
    page.getByText(/verified in PayPal/).first().waitFor(),
    errorBanner.waitFor().then(async () => {
      throw new Error(await errorBanner.innerText());
    }),
  ]);
  await page.waitForFunction(() => document.querySelector('[data-testid="step-sync-mark"]')?.textContent?.includes("✓"));
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
  await page.getByTestId("stat-orders").waitFor();
  await settledStat(page, "stat-on-hold", "10");
  await page.getByTestId("hero").screenshot({ path: path.join(dir, "hero.png") });
  await page.screenshot({ path: path.join(dir, "home.png"), fullPage: true });

  await enabled(page, "step-load");
  await page.getByTestId("step-load").click();
  await page.getByText(/manifest rows loaded|条发货记录已载入/).waitFor();
  await page.waitForFunction(() => document.querySelector('[data-testid="step-load-mark"]')?.textContent?.includes("✓"));
  await enabled(page, "step-match");
  await page.getByTestId("step-match").click();
  await page.getByText("YT202611110001").waitFor();
  await page.getByText("Seller Protection risk: ship only to PayPal address").first().waitFor();
  await page.waitForFunction(() => document.querySelector('[data-testid="step-match-mark"]')?.textContent?.includes("✓"));
  await page.screenshot({ path: path.join(dir, "matched-grid.png"), fullPage: true });

  await enabled(page, "step-sync");
  await page.getByTestId("step-sync").click();
  await page.getByText("verified in PayPal").first().waitFor();
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
  await page.waitForFunction(() => document.querySelector('[data-testid="step-sync-mark"]')?.textContent?.includes("✓"));
  await page.screenshot({ path: path.join(dir, "after-sync.png"), fullPage: true });
  await page.screenshot({ path: path.join(dir, "synced.png"), fullPage: true });

  await page.getByTestId("buyer-email").fill("Where is my order?? Order SB-1001. This is Emily Carter and I may open a dispute.");
  await page.getByTestId("draft-reply").click();
  await page.getByText("YT202611110001").last().waitFor();
  await page.getByTestId("reply-output").scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(dir, "buyer-reply.png"), fullPage: true });

  await page.getByTestId("lang-zh").click();
  await page.getByText("减少未收到货争议，加快卖家资金解冻，让跨境商户继续留在 PayPal。").waitFor();
  await page.getByText("载入示例").waitFor();
  await page.screenshot({ path: path.join(dir, "chinese.png"), fullPage: true });

  await browser.close();
  console.log("screenshots written to", dir);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
