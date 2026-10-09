// Drives the running app (npm run dev) through every process once and saves screenshots to .data/shots.
import { chromium, type Page } from "playwright";
import { mkdirSync } from "node:fs";

const URL = process.env.APP ?? "http://localhost:5173";
const OUT = ".data/shots";
mkdirSync(OUT, { recursive: true });

const idle = async (page: Page, timeout = 300_000) => {
  await page.waitForTimeout(500);
  await page.waitForFunction(() => !document.querySelector(".status.busy"), null, { timeout });
  const err = await page.locator(".status.error").allTextContents();
  if (err.length) console.log("  ⚠", err.join(" | "));
};
const shot = (page: Page, name: string) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
const tab = (page: Page, label: string) => page.locator("nav button", { hasText: label }).first().click();
const btn = (page: Page, text: string) => page.locator("main button", { hasText: text }).first();
const step = (msg: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${msg}`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on("pageerror", (e) => console.log("  pageerror:", e.message));
await page.goto(URL);
await page.evaluate(() => localStorage.clear());
await page.reload();

step("P1 generate + select");
await page.fill("textarea", "a small bedside table with an open shelf and four straight legs");
await btn(page, "Generate concepts").click();
await idle(page);
await btn(page, "Use concept 1").click();
await shot(page, "p1");

step("P2 edit");
await page.locator("textarea").nth(1).fill("make the legs slightly thicker");
await btn(page, "Apply edit").click();
await idle(page);
await shot(page, "p2");

step("P3 spec + revise");
await tab(page, "Specification");
await btn(page, "Generate spec").click();
await idle(page);
await page.fill("textarea", "make it 500 mm tall");
await btn(page, "Revise spec").click();
await idle(page);
await shot(page, "p3");

step("P4 build parts");
await tab(page, "Parts");
await btn(page, "Build parts").click();
await idle(page, 600_000);
await shot(page, "p4");

step("P5 refine");
await tab(page, "Refine parts");
await btn(page, "Refine parts").click();
await idle(page, 600_000);
await shot(page, "p5");

step("P7 assemble");
await btn(page, "Assemble refined parts").click();
await page.waitForTimeout(1000);
await page.locator(".inspector select").first().selectOption({ index: 1 });
await shot(page, "p7");

step("P8 regenerate part");
await btn(page, "Regenerate selected part").click();
await idle(page);
const replace = page.locator("button", { hasText: "with r32" });
if (await replace.count()) await replace.click();

step("P9 language edit");
await page.locator(".inspector textarea").fill("add a thin lower shelf between the legs");
await btn(page, "Plan change").click();
await idle(page);
await shot(page, "p9");
const apply = page.locator("button", { hasText: /^Apply \d+ part/ });
if (await apply.count()) await apply.click();

step("P10 fabrication");
await tab(page, "Fabrication");
await btn(page, "Check design").click();
await idle(page);
await shot(page, "p10a");
const fix = page.locator(".suggestions button").first();
if (await fix.count()) { await fix.click(); await idle(page); }
await shot(page, "p10b");

step("P11 export");
await tab(page, "Export");
await btn(page, "Full package").click();
await shot(page, "p11");

step("P6 part studio");
await tab(page, "Part studio");
await page.fill("textarea", "a curved side bracket");
await btn(page, "Generate part images").click();
await idle(page);
await btn(page, "Use option 1").click();
await idle(page);
await shot(page, "p6");

await browser.close();
step("done");
