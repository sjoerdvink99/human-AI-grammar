// Drives the web UI through all five processes and saves screenshots to /tmp/ss-*.png.
// Usage: CHROME=/path/to/chrome node scripts/ui-walk.mjs   (server must be running on BASE)
import { chromium } from "playwright-core";
const base = process.env.BASE ?? "http://localhost:3001";
const browser = await chromium.launch({ executablePath: process.env.CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
page.on("pageerror", (e) => console.log("PAGE ERROR", e.message));
const shot = async (n) => { await page.screenshot({ path: `/tmp/ss-${n}.png`, fullPage: true }); console.log("📸", n); };
const T = { timeout: 240000 };
await page.goto(base);
await page.evaluate(() => localStorage.clear());
await page.reload();
// P1
await page.fill(".composer textarea", "A 1-minute farewell speech for my colleague Priya, who is leaving our research lab after 6 years. I'm her team lead. About 25 lab members at Friday drinks.");
await page.click("text=Send");
await page.waitForSelector(".bubble.assistant", T);
await shot("1-brief-round1");
if (await page.isDisabled("text=Continue to script →")) {
  await page.fill(".composer textarea", "Mention how she rebuilt our data pipeline, her Friday baking, and that she mentored every new PhD student. Warm and a bit funny.");
  await page.click("text=Send");
  await page.waitForSelector(".bubble.assistant >> nth=1", T);
}
await shot("1-brief-round2");
await page.click("text=Continue to script →");
// P2
await page.waitForSelector("textarea.approach", T);
await page.fill("textarea.approach", (await page.inputValue("textarea.approach")) + "\n- Close by thanking her on behalf of the whole lab.");
await page.click("text=Plan & write script");
await page.waitForSelector(".script", T);
await page.fill(".field textarea", "Make the baking joke a bit more prominent.");
await page.click("text=Revise script");
await page.waitForSelector("text=v2", T);
await page.waitForFunction(() => !document.body.innerText.includes("Revising…"), null, T);
await shot("2-script");
await page.click("text=/Use v\\d → Voice/");
// P3
await page.waitForFunction(() => !document.body.innerText.includes("Reading the script…"), null, T);
await page.waitForTimeout(500);
await shot("3-voice");
await page.click("text=Record take");
await page.waitForSelector("audio", T);
// P4
await page.waitForFunction(() => !document.body.innerText.includes("Analysing the take…"), null, T);
await shot("4-review");
await page.fill("textarea[placeholder^='How did it sound']", "Too fast and a bit monotone; the thank-you at the end should be slower.");
await page.click("text=Get coaching tips");
await page.waitForSelector("text=Ask the coach", T);
await page.fill("textarea[placeholder^='e.g. How do I stop']", "How do I deliver a heartfelt thank-you without getting choked up?");
await page.click("button:has-text('Ask')");
await page.waitForFunction(() => document.querySelectorAll(".qa .bubble.assistant .prose").length > 0, null, T);
await shot("4-coach");
// P5
await page.click(".card:has-text('Adjust voice') .seg button:has-text('long')");
await page.click("text=/Record take \\d/");
await page.waitForSelector("text=Take 2", T);
await page.waitForSelector("text=Comparing with take 1", T);
await shot("5-retake");
await browser.close();
console.log("UI WALK OK");
