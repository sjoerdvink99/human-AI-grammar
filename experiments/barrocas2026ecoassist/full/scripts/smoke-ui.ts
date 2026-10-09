// Walks processes 2–4 through the UI (needs a running production server; PORT env).
import { chromium } from "playwright";
const port = process.env.PORT ?? "3001";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1500, height: 900 } });
p.on("dialog", (d) => d.accept());
await p.goto(`http://localhost:${port}`);
await p.evaluate(() => localStorage.clear());
await p.reload();
// process 2 (or EXAMPLE=1 to load the hand-written example instead of generating)
if (process.env.EXAMPLE) await p.click("button:has-text('Load example')");
else {
await p.fill("#request", "A small todo list with add and delete buttons");
await p.click("button[role=radio]:has-text('haiku')");
await p.click("button:has-text('Generate code')");
await p.waitForSelector("button:has-text('Regenerate')", { timeout: 180000 });
}
console.log("editor has", (await p.locator(".cm-content").innerText()).length, "chars");
await p.screenshot({ path: "docs/screenshot-generate.png" });
// process 3
await p.click("button:has-text('Optimize for energy')");
await p.waitForSelector(".review-bar", { timeout: 400000 });
const hunks = await p.locator(".hunk").count();
console.log("review shows", hunks, "hunks;", await p.locator(".energy-head").innerText());
if (hunks > 1) await p.locator(".hunk input[type=checkbox]").first().uncheck();
await p.screenshot({ path: `docs/screenshot-review${process.env.EXAMPLE ? "-example" : ""}.png` });
if (hunks > 0) await p.click("button:has-text('selected')");
else await p.click("button.tab:has-text('Preview')");
// process 4
await p.waitForSelector(".preview iframe");
await p.waitForTimeout(1500);
const frame = p.frames().find((f) => f !== p.mainFrame());
console.log("preview:", (await p.locator(".preview-bar span").first().innerText()), "| frame text:", JSON.stringify((await frame?.evaluate(() => document.body.innerText))?.slice(0, 60)));
console.log("history:", await p.locator("header select option").allInnerTexts());
await p.screenshot({ path: "docs/screenshot-preview.png" });
await b.close();
