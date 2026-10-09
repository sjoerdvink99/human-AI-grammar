// tool_2 execute: run simulation code in a headless browser (Playwright Chromium).
import { chromium, type Browser, type Page } from "playwright";
import type { TestCase, TestResult } from "../shared/types.js";

let browserP: Promise<Browser> | null = null;
function browser() {
  browserP ??= chromium.launch();
  return browserP;
}

const VIEWPORT = { width: 900, height: 640 };

async function openPage(html: string, sink: string[]): Promise<Page> {
  const page = await (await browser()).newPage({ viewport: VIEWPORT });
  page.on("pageerror", (e) => sink.push(`Uncaught ${e.name}: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") sink.push(`console.error: ${m.text()}`);
  });
  page.on("dialog", (d) => d.dismiss().catch(() => {}));
  await page.route("**/*", (r) => (r.request().url().startsWith("data:") ? r.continue() : r.abort()));
  await page.setContent(html, { waitUntil: "load", timeout: 15000 }).catch((e) => sink.push(`load: ${e.message}`));
  return page;
}

/** Load the code, poke every control once, and collect JavaScript errors. */
export async function loadAndCollectErrors(html: string): Promise<string[]> {
  const errors: string[] = [];
  const page = await openPage(html, errors);
  try {
    await page.waitForTimeout(800);
    // Exercise controls generically so errors in event handlers surface too.
    await page.evaluate(() => {
      for (const el of Array.from(document.querySelectorAll("input,select"))) {
        const i = el as HTMLInputElement;
        if (i.type === "range" || i.type === "number") i.value = String((Number(i.min || 0) + Number(i.max || 100)) / 2);
        else if (i.type === "checkbox") i.checked = !i.checked;
        i.dispatchEvent(new Event("input", { bubbles: true }));
        i.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    await page.waitForTimeout(400);
    for (const b of await page.$$("button")) await b.click({ timeout: 1000 }).catch(() => {});
    await page.waitForTimeout(800);
  } finally {
    await page.close();
  }
  return [...new Set(errors)];
}

/** Run test cases; one result and one screenshot (PNG data URL) per case. */
export async function runTests(html: string, tests: TestCase[]): Promise<{ results: TestResult[]; screenshots: string[] }> {
  const results: TestResult[] = [];
  const screenshots: string[] = [];
  for (const t of tests) {
    const consoleErrors: string[] = [];
    const stepErrors: string[] = [];
    const reads: string[] = [];
    const page = await openPage(html, consoleErrors);
    try {
      await page.waitForTimeout(500);
      for (const [i, s] of t.steps.entries()) {
        try {
          if (s.action === "wait") await page.waitForTimeout(Math.min(Number(s.value ?? 500), 3000));
          else if (s.action === "click") await page.click(s.selector, { timeout: 2000 });
          else if (s.action === "set_value") {
            const ok = await page.$eval(
              s.selector,
              (el, v) => {
                const i = el as HTMLInputElement;
                if (i.type === "checkbox") i.checked = v === "true" || v === "1";
                else i.value = v;
                i.dispatchEvent(new Event("input", { bubbles: true }));
                i.dispatchEvent(new Event("change", { bubbles: true }));
                return true;
              },
              String(s.value ?? ""),
            );
            if (!ok) throw new Error("not set");
          } else if (s.action === "read_text") {
            reads.push(`${s.selector} = ${(await page.$eval(s.selector, (el) => (el as HTMLElement).innerText || (el as HTMLInputElement).value || "")).slice(0, 200)}`);
          }
        } catch (e) {
          stepErrors.push(`step ${i + 1} (${s.action} ${s.selector}): ${(e as Error).message.split("\n")[0]}`);
        }
      }
      await page.waitForTimeout(300);
      const png = await page.screenshot({ type: "png" });
      screenshots.push(`data:image/png;base64,${png.toString("base64")}`);
      const visible = await page.evaluate(() => document.body?.innerText ?? "").catch(() => "");
      results.push({ test_id: t.id, step_errors: stepErrors, console_errors: [...new Set(consoleErrors)], read_values: reads, visible_text: visible.slice(0, 1500) });
    } finally {
      await page.close();
    }
  }
  return { results, screenshots };
}

export async function closeBrowser() {
  if (browserP) (await browserP).close();
}
