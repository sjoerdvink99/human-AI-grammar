// End-to-end walkthrough of all eight processes in a headless browser.
// Requires `npm run dev` (API on 8787, web on 5173). Screenshots go to .tmp/.
import { chromium } from "playwright";

const URL = process.env.APP_URL ?? "http://localhost:5173";
const shot = (page, n) => page.screenshot({ path: `.tmp/e2e-${n}.png`, fullPage: false });
const log = (...a) => console.log("•", ...a);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on("pageerror", (e) => console.error("PAGE ERROR", e.message));
await page.goto(URL);
await page.evaluate(() => localStorage.clear());
await page.reload();

// P1
await page.getByRole("button", { name: "Load example" }).click();
await page.getByRole("button", { name: "Generate elements" }).click();
await page.waitForSelector(".stage img", { timeout: 300_000 });
log("P1 scene rendered, round", await page.locator(".pill").first().textContent());
await shot(page, "1-scene");

// P2
const state = await page.evaluate(() => JSON.parse(localStorage.getItem("system-x-state-v1") ?? "{}"));
const cited = state.elements.find((e) => e.sources.length) ?? state.elements[0];
await page.locator(".el-list li", { hasText: cited.name }).first().click();
await page.waitForSelector(".provenance");
log("P2 provenance marks:", await page.locator(".provenance mark").count());
await shot(page, "2-provenance");

// P3
await page.locator(".critique textarea").fill("Move the selected element a bit to the right.");
const box = await page.locator(".box.sel").boundingBox();
await page.mouse.move(box.x + 10, box.y + 10);
await page.mouse.down();
await page.mouse.move(box.x + 40, box.y + 20, { steps: 5 });
await page.mouse.up();
log("P3 dirty:", await page.locator(".pill.warn").count());
await page.getByRole("button", { name: /Re-render/ }).click();
log("P3 after re-render:", await page.locator(".pill").first().textContent());
await shot(page, "3-rerender");

// P4
await page.getByRole("button", { name: /^Illustrate/ }).click();
const ill = state.elements.find((e) => e.kind === "illustration") ?? state.elements[0];
await page.locator(".card", { hasText: ill.name }).first().click();
await page.getByRole("button", { name: "Generate illustration" }).click();
await page.waitForSelector(".results .result img", { timeout: 300_000 });
log("P4 illustration generated");
await shot(page, "4-illustration");

// P5
await page.getByRole("button", { name: /^Chart/ }).click();
await page.getByRole("button", { name: "column", exact: true }).click();
await page.waitForSelector(".chart-img");
log("P5 chart rendered");
await shot(page, "5-chart");

// P6 / P7
async function cutout(mode) {
  await page.getByRole("button", { name: /^Pictorial chart/ }).click();
  await page.getByRole("button", { name: mode === 6 ? "Auto placement" : "Place manually" }).click();
  await page.getByRole("button", { name: "Start over" }).click();
  const img = await page.locator(".region-stage img").boundingBox();
  const k = img.width / 1000;
  const r = { x: img.x + ill.x * k, y: img.y + ill.y * k, w: ill.w * k, h: ill.h * k };
  await page.mouse.move(r.x + 2, r.y + 2);
  await page.mouse.down();
  await page.mouse.move(r.x + r.w - 2, r.y + r.h - 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForSelector(".crop-stage img");
  const c = await page.locator(".crop-stage").boundingBox();
  await page.mouse.click(c.x + c.width * 0.5, c.y + c.height * 0.55);
  await page.getByRole("button", { name: "Extract object" }).click();
  await page.waitForSelector(".cutout-preview img, .crop-stage + .row + .error, p.error", { timeout: 300_000 });
  if (await page.locator("p.error").count()) throw new Error("extract failed: " + (await page.locator("p.error").textContent()));
  if (mode === 7) {
    const pl = await page.locator(".placed").boundingBox();
    await page.mouse.move(pl.x + pl.width / 2, pl.y + pl.height / 2);
    await page.mouse.down();
    await page.mouse.move(pl.x + pl.width / 2 - 120, pl.y + pl.height / 2 + 60, { steps: 6 });
    await page.mouse.up();
    await page.getByRole("button", { name: "Compose", exact: true }).click();
  }
  await page.waitForSelector(".pictorial-grid .chart-img");
  await page.getByRole("button", { name: "Keep result" }).click();
  log(`P${mode} pictorial chart kept; total kept:`, await page.locator(".kept .result").count());
  await shot(page, `${mode}-pictorial`);
}
await cutout(6);
await cutout(7);

// P8
await page.getByRole("button", { name: /^Gallery/ }).click();
await page.locator(".thumb").first().click();
await page.locator(".review textarea").fill("Round 2 reads better; the hero is balanced.");
await page.getByRole("button", { name: "Add review" }).click();
log("P8 reviews:", await page.locator(".reviews li").count());
await shot(page, "8-gallery");

await browser.close();
