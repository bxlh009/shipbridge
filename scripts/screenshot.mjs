import fs from "fs";
import path from "path";
import { chromium } from "playwright";

const base = process.env.SHIPBRIDGE_URL || "http://127.0.0.1:3000";
const dir = path.resolve("screenshots");

async function main() {
  fs.mkdirSync(dir, { recursive: true });
  await fetch(`${base}/api/seed`, { method: "POST" });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(30000);
  await page.goto(base, { waitUntil: "networkidle" });
  await page.getByTestId("stat-orders").waitFor();
  await page.screenshot({ path: path.join(dir, "home.png"), fullPage: true });

  await page.getByTestId("use-sample").click();
  await page.getByText(/manifest rows loaded|条发货记录已载入/).waitFor();
  await page.getByTestId("match-orders").click();
  await page.getByText("YT202611110001").waitFor();
  await page.getByText("Seller Protection risk: ship only to PayPal address").first().waitFor();
  await page.screenshot({ path: path.join(dir, "matched-grid.png"), fullPage: true });

  await page.getByTestId("sync-tracking").click();
  await page.getByText("verified in PayPal").first().waitFor();
  await page.screenshot({ path: path.join(dir, "synced.png"), fullPage: true });

  await page.getByTestId("buyer-email").fill("Where is my order?? Order SB-1001. This is Emily Carter and I may open a dispute.");
  await page.getByTestId("draft-reply").click();
  await page.getByText("YT202611110001").last().waitFor();
  await page.getByTestId("reply-output").scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(dir, "buyer-reply.png"), fullPage: true });

  await page.getByTestId("lang-zh").click();
  await page.getByText("给 PayPal 中国跨境小卖家的物流回传台").waitFor();
  await page.screenshot({ path: path.join(dir, "chinese.png"), fullPage: true });

  await browser.close();
  console.log("screenshots written to", dir);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
