// tool_1 execute: render HTML source to a screenshot with headless Chromium.
import { chromium } from 'playwright';

export const VIEWPORT = { width: 1280, height: 800 };
export const MAX_HEIGHT = 3000;

let browserPromise = null;
function browser() {
  if (!browserPromise) browserPromise = chromium.launch();
  return browserPromise;
}

export async function closeBrowser() {
  if (browserPromise) {
    const b = await browserPromise;
    browserPromise = null;
    await b.close();
  }
}

/** @returns {Promise<Buffer>} PNG of the page, full width, height capped at MAX_HEIGHT */
export async function renderHtml(html) {
  const ctx = await (await browser()).newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  try {
    const page = await ctx.newPage();
    await page
      .setContent(html, { waitUntil: 'load', timeout: 10_000 })
      .catch(() => {}); // slow external assets: render whatever has loaded
    await page.waitForTimeout(150);
    const height = await page
      .evaluate(() => Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0))
      .catch(() => VIEWPORT.height);
    const h = Math.min(Math.max(height, VIEWPORT.height), MAX_HEIGHT);
    await page.setViewportSize({ width: VIEWPORT.width, height: h });
    return await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: VIEWPORT.width, height: h } });
  } finally {
    await ctx.close();
  }
}
