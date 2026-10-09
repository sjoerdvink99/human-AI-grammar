// tool_2 = headless browser automation (Playwright). Deterministic execution of simulation code.
import { chromium, type Browser, type Page } from 'playwright';
import { SIM_HEIGHT, SIM_WIDTH, type TestCase, type TestResult } from '../shared/types.js';

let browserPromise: Promise<Browser> | null = null;
function getBrowser() {
  if (!browserPromise) browserPromise = chromium.launch();
  return browserPromise;
}

async function openSimulation(html: string, errors: string[]): Promise<Page> {
  const browser = await getBrowser();
  const page = await browser.newPage({ viewport: { width: SIM_WIDTH, height: SIM_HEIGHT } });
  page.on('pageerror', (e) => errors.push(`${e.name}: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  await page.setContent(html, { waitUntil: 'load', timeout: 15_000 });
  await page.waitForTimeout(800);
  return page;
}

/** P3 [tool_2 execute]: run the code and collect javascript_errors */
export async function runForErrors(html: string): Promise<{ javascript_errors: string[] }> {
  const errors: string[] = [];
  const page = await openSimulation(html, errors);
  try {
    // Nudge every control once so that handler errors surface too.
    await page.evaluate(() => {
      document.querySelectorAll('input[type=range], input[type=number]').forEach((el) => {
        const input = el as HTMLInputElement;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
    });
    await page.waitForTimeout(800);
  } catch (e) {
    errors.push(String(e));
  } finally {
    await page.close();
  }
  return { javascript_errors: [...new Set(errors)] };
}

async function setValue(page: Page, selector: string, value: string) {
  await page.$eval(
    selector,
    (el, v) => {
      const input = el as HTMLInputElement | HTMLSelectElement;
      if (input instanceof HTMLInputElement && (input.type === 'checkbox' || input.type === 'radio')) {
        input.checked = v === 'true' || v === 'on' || v === '1';
      } else {
        input.value = v;
      }
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    },
    value,
  );
}

/** Snapshot of displayed values: text of every element tagged with a ui graph node id. */
async function readDisplays(page: Page): Promise<string> {
  return page.evaluate(() => {
    const parts: string[] = [];
    document.querySelectorAll('[data-ui-node]').forEach((el) => {
      const h = el as HTMLElement;
      const v = h instanceof HTMLInputElement || h instanceof HTMLSelectElement ? `value=${h.value}` : '';
      const t = (h.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 80);
      parts.push(`${h.getAttribute('data-ui-node')}: ${v} ${t}`.trim());
    });
    return parts.join(' | ').slice(0, 1500);
  });
}

/** P3 [tool_2 execute]: run test_cases, capture test_results and test_screenshots */
export async function runTests(
  html: string,
  test_cases: TestCase[],
): Promise<{ test_results: TestResult[]; test_screenshots: { test_id: string; dataUrl: string }[] }> {
  const test_results: TestResult[] = [];
  const test_screenshots: { test_id: string; dataUrl: string }[] = [];
  for (const tc of test_cases) {
    const errors: string[] = [];
    const observations: string[] = [];
    let completed = true;
    const page = await openSimulation(html, errors);
    try {
      observations.push(`initial: ${await readDisplays(page)}`);
      for (const [i, step] of tc.steps.entries()) {
        try {
          switch (step.action) {
            case 'click':
              await page.click(step.selector, { timeout: 3000 });
              break;
            case 'set_value':
              await setValue(page, step.selector, step.value ?? '');
              break;
            case 'press':
              await page.keyboard.press(step.value || 'Enter');
              break;
            case 'wait':
              await page.waitForTimeout(Math.min(Number(step.value) || 500, 5000));
              break;
            case 'read': {
              const text = await page.$eval(step.selector, (el) => {
                const h = el as HTMLElement;
                return h instanceof HTMLInputElement ? h.value : (h.innerText || '').trim().slice(0, 200);
              });
              observations.push(`step ${i + 1} read ${step.selector}: ${text}`);
              break;
            }
          }
          await page.waitForTimeout(250);
        } catch (e) {
          completed = false;
          errors.push(`step ${i + 1} (${step.action} ${step.selector}) failed: ${(e as Error).message.split('\n')[0]}`);
          break;
        }
      }
      await page.waitForTimeout(500);
      observations.push(`final: ${await readDisplays(page)}`);
      const shot = await page.screenshot({ type: 'jpeg', quality: 70 });
      test_screenshots.push({ test_id: tc.id, dataUrl: `data:image/jpeg;base64,${shot.toString('base64')}` });
    } finally {
      await page.close();
    }
    test_results.push({ test_id: tc.id, completed, observations, errors: [...new Set(errors)] });
  }
  return { test_results, test_screenshots };
}

/**
 * Renders the simulation and draws a freehand region mark over it, so a model can see which part
 * the teacher circled. Used to build model inputs for P5, P7 and P8 (not a design step by itself).
 */
export async function annotatedScreenshot(html: string, points: [number, number][]): Promise<string> {
  const errors: string[] = [];
  const page = await openSimulation(html, errors);
  try {
    await page.evaluate((pts) => {
      const ns = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(ns, 'svg');
      svg.setAttribute('style', 'position:fixed;left:0;top:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483647');
      const pl = document.createElementNS(ns, 'polyline');
      pl.setAttribute('points', pts.map((p) => p.join(',')).join(' '));
      pl.setAttribute('fill', 'rgba(255,0,0,0.08)');
      pl.setAttribute('stroke', 'red');
      pl.setAttribute('stroke-width', '4');
      svg.appendChild(pl);
      document.body.appendChild(svg);
    }, points);
    const shot = await page.screenshot({ type: 'png' });
    return `data:image/png;base64,${shot.toString('base64')}`;
  } finally {
    await page.close();
  }
}
