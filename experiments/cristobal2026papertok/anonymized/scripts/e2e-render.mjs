// Drives the Export tab in a real browser: tool_2 translate + compose (r36, r37).
// Usage: node scripts/e2e-render.mjs [url] [chromeExecutable]
import { chromium } from "playwright-core";
import { writeFileSync } from "node:fs";
const url = process.argv[2] || "http://localhost:3001";
const exe = process.argv[3];
const browser = await chromium.launch({ executablePath: exe, args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
page.on("console", (m) => m.type() === "error" && console.log("console:", m.text()));
await page.goto(url);
for (const [tab, file] of [["2 · Concepts", "concepts"], ["3 · Script", "script"], ["4 · Scenes", "scenes"], ["5 · Export", "export"]]) {
  await page.getByRole("button", { name: tab }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `.check/${file}.png`, fullPage: false });
}
await page.getByRole("button", { name: "9:16 vertical" }).click();
await page.getByRole("button", { name: "Render video" }).click();
await page.waitForSelector(".result video", { timeout: 300000 });
const info = await page.evaluate(async () => {
  const v = document.querySelector(".result video");
  const blob = await (await fetch(v.src)).blob();
  await new Promise((r) => (v.readyState >= 1 ? r() : (v.onloadedmetadata = r)));
  return { size: blob.size, type: blob.type, w: v.videoWidth, h: v.videoHeight };
});
console.log("video", info);
await page.screenshot({ path: ".check/rendered.png", fullPage: true });
await page.evaluate(async () => {
  const v = document.querySelector(".result video");
  v.currentTime = 25;
  await new Promise((r) => (v.onseeked = r));
});
await page.locator(".result video").screenshot({ path: ".check/frame.png" });
await browser.close();
