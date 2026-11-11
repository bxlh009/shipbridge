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

async function holdCount(page, count) {
  await page.waitForFunction((expected) => {
    const el = document.querySelector('[data-testid="stat-on-hold"]');
    return Boolean(el && el.getAttribute("data-settled") === "true" && el.textContent.trim() === expected);
  }, String(count));
}

async function main() {
  fs.mkdirSync(dir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(30000);
  await page.goto(base, { waitUntil: "networkidle" });
  await page.getByTestId("hero-pitch").waitFor();
  await page.getByTestId("stat-orders").waitFor();
  await holdCount(page, "10");
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
  await holdCount(page, "2");
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
