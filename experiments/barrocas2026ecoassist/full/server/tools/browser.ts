import { chromium, type Browser, type CDPSession, type Page } from "playwright";
import type { Rendering, WebCode } from "../../shared/types.ts";
import { toPreviewDocument } from "../../shared/preview.ts";

/** tool_1: browser automation (Playwright Chromium). */

let browserPromise: Promise<{ browser: Browser; cdp: CDPSession }> | null = null;

export async function getBrowser() {
  if (!browserPromise) {
    browserPromise = (async () => {
      const browser = await chromium.launch({ args: ["--enable-gpu-rasterization"] });
      const cdp = await browser.newBrowserCDPSession();
      browser.on("disconnected", () => (browserPromise = null));
      return { browser, cdp };
    })();
  }
  return browserPromise;
}

export async function closeBrowser() {
  if (browserPromise) {
    const { browser } = await browserPromise;
    browserPromise = null;
    await browser.close();
  }
}

/** Serialize browser work so concurrent measurements don't disturb each other's CPU readings. */
let queue: Promise<unknown> = Promise.resolve();
export function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

export const VIEWPORT = { width: 1024, height: 700 };

export interface LoadedPage {
  page: Page;
  consoleErrors: string[];
  transferBytes: number;
  loadMs: number;
  close: () => Promise<void>;
}

/** Load code into a fresh browser context. Caller must close. */
export async function loadPage(code: WebCode, browser: Browser): Promise<LoadedPage> {
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();
  const consoleErrors: string[] = [];
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
  page.on("pageerror", (e) => consoleErrors.push(String(e.message)));
  const doc = toPreviewDocument(code);
  let transferBytes = Buffer.byteLength(doc);
  page.on("response", async (r) => {
    const len = Number(r.headers()["content-length"] ?? 0);
    if (len) transferBytes += len;
  });
  const t0 = Date.now();
  await page.setContent(doc, { waitUntil: "load", timeout: 15_000 }).catch((e) => consoleErrors.push(`load: ${e.message}`));
  const loadMs = Date.now() - t0;
  return {
    page,
    consoleErrors,
    get transferBytes() {
      return transferBytes;
    },
    loadMs,
    close: () => context.close(),
  };
}

export async function screenshot(page: Page): Promise<string> {
  const buf = await page.screenshot({ type: "png", animations: "disabled" }).catch(() => Buffer.alloc(0));
  return buf.toString("base64");
}

/** tool_1 execute: load a page and produce a rendering. */
export async function renderPage(code: WebCode): Promise<Rendering> {
  return exclusive(async () => {
    const { browser } = await getBrowser();
    const p = await loadPage(code, browser);
    await p.page.waitForTimeout(300);
    const shot = await screenshot(p.page);
    await p.close();
    return { screenshot: shot, consoleErrors: p.consoleErrors, loadMs: p.loadMs };
  });
}
