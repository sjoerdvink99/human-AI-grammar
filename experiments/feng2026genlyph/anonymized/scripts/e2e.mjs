// End-to-end walkthrough of every process against the running dev servers (real model calls).
// Usage: npm run dev (in another shell), then: node scripts/e2e.mjs
import { chromium } from "playwright";
import fs from "node:fs";

const URL = process.env.APP_URL ?? "http://localhost:5173";
const OUT = "e2e-shots";
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
page.on("pageerror", (e) => console.error("PAGE ERROR", e.message));
const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png`, fullPage: true });
const step = (m) => console.log(new Date().toISOString().slice(11, 19), m);
const LONG = { timeout: 300_000 };

await page.goto(URL);
await page.evaluate(() => localStorage.clear());
await page.reload();

step("P1: load sample, brainstorm & illustrate");
await page.getByRole("button", { name: "fruit-harvest.csv" }).click();
await page.locator(".cta select").selectOption("2");
await shot("1-data");
await page.getByRole("button", { name: /Brainstorm/ }).click();
await page.locator(".gallery .card .svgbox svg").first().waitFor(LONG);
await page.waitForFunction(() => !document.querySelector(".gallery .spinner"), null, LONG);
await shot("2-illustrate-round1");

step("P2: steer a second round");
await page.locator("textarea").first().fill("five wicker baskets on a wooden table, each heaped with one kind of fruit, flat colours");
await page.locator(".panel select").first().selectOption("2");
await page.getByRole("button", { name: /Generate with my direction/ }).click();
await page.getByRole("button", { name: "Round 2" }).waitFor();
await page.waitForFunction(() => !document.querySelector(".gallery .spinner"), null, LONG);
await shot("3-illustrate-round2");

step("P3: select an illustration");
await page.locator(".gallery .card.clickable").first().click();
await page.getByRole("button", { name: /Use this illustration/ }).click();

step("P4: draw selections, segment, edit, label");
const overlay = page.locator(".canvas .overlay");
const box = await overlay.boundingBox();
const drag = async (x0, y0, x1, y1) => {
  await page.mouse.move(box.x + box.width * x0, box.y + box.height * y0);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * x1, box.y + box.height * y1, { steps: 5 });
  await page.mouse.up();
};
await drag(0.02, 0.25, 0.22, 0.95);
await drag(0.38, 0.25, 0.6, 0.95);
await drag(0.78, 0.25, 0.98, 0.95);
await page.getByRole("button", { name: /Segment selections/ }).click();
await page.locator(".segrow").first().waitFor(LONG);
await shot("4-segments");
// human modify: toggle one shape out of and back into the active segment
const firstShape = page.locator(".canvas .svgbox [data-eid]").nth(3);
await firstShape.click({ force: true });
await firstShape.click({ force: true });
const row = page.locator(".segrow").first();
await row.locator("select").first().selectOption("mark");
await row.locator("select").nth(1).selectOption("fruit");
await shot("5-labels");
await page.getByRole("button", { name: "Continue →" }).click();

step("P5: crops, descriptions, variants");
await page.getByRole("button", { name: /Cut out & generate variants/ }).click();
await page.locator(".variants .card").first().waitFor(LONG);
await page.waitForFunction(() => !document.querySelector(".spinner"), null, LONG);
await shot("6-variants");
step("P5 loop: edit a prompt and regenerate one variant");
const card = page.locator(".variants .card").first();
await card.locator("summary").click();
await card.locator("textarea").fill((await card.locator("textarea").inputValue()) + "\nMake it a little rounder.");
await card.getByRole("button", { name: "Regenerate" }).click();
await page.waitForFunction(() => !document.querySelector(".spinner"), null, LONG);
await card.locator(".history button").first().waitFor();

step("P6: chart spec and layouts");
await page.getByRole("button", { name: /Build charts/ }).click();
await page.locator(".charts figure").first().waitFor();
await page.locator(".form select").nth(3).selectOption("desc");
await shot("7-charts");

step("P7: query, match, select, finalize");
await page.getByRole("button", { name: "Annotate →" }).click();
await page.getByRole("button", { name: "Find" }).click();
await page.locator(".checks li").first().waitFor();
await page.locator(".form input").first().fill("Fruit harvest by type");
await page.locator(".form select").first().selectOption("1");
await shot("8-annotate");

step("P8: export");
await page.getByRole("button", { name: "Export →" }).click();
await page.getByRole("button", { name: "PNG (3×)" }).click();
const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Download PNG/ }).click()]);
await dl.saveAs(`${OUT}/export.png`);
await shot("9-export");
step(`done; exported ${fs.statSync(`${OUT}/export.png`).size} bytes`);
await browser.close();
