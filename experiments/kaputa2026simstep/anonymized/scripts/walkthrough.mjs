// End-to-end walkthrough of all 8 processes in a headless browser (uses real model calls).
// Usage: npm run dev (in another shell), then: node scripts/walkthrough.mjs [baseUrl]
import { chromium } from 'playwright';
import fs from 'node:fs';

const base = process.argv[2] || 'http://localhost:5173';
const out = '.tmp/shots';
fs.mkdirSync(out, { recursive: true });
const T = 10 * 60_000;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
page.on('pageerror', (e) => log('PAGE ERROR', e.message));
const shot = (n) => page.screenshot({ path: `${out}/${n}.png`, fullPage: true });
const notBusy = () => page.waitForFunction(() => !document.querySelector('.statusbar.busy'), null, { timeout: T });
const assertNoError = async (step) => {
  const err = await page.locator('.statusbar.has-error').count();
  if (err) throw new Error(`${step}: ${await page.locator('.statusbar').innerText()}`);
};
async function drag(x0, y0, x1, y1) {
  const box = await page.locator('.ws-left .overlay').boundingBox();
  await page.mouse.move(box.x + x0, box.y + y0);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(box.x + x0 + ((x1 - x0) * i) / 8, box.y + y0 + ((y1 - y0) * i) / 8);
  await page.mouse.up();
}

await page.goto(base);
await page.evaluate(() => localStorage.clear());
await page.reload();

log('P1: request → intent graph');
await page.locator('textarea').first().fill('Show how monthly rainfall compares across five cities over a year, so I can see which city is wettest in each season.');
await page.getByRole('button', { name: 'Translate to intent graph' }).click();
await page.getByRole('button', { name: 'Edit graph' }).waitFor({ timeout: T });
await assertNoError('intent graph');

log('P2: modify intent graph');
await page.getByRole('button', { name: 'Edit graph' }).click();
await page.locator('.graph-editor tbody tr input').first().fill('Find the wettest city per season');
await page.getByRole('button', { name: 'Save as new version' }).click();
await page.getByText('versions: r2_1, r2_2').waitFor();
await shot('01-intent');

log('P1: concepts');
await page.getByRole('button', { name: /Generate design concepts/ }).click();
await page.locator('.step', { hasText: 'Design concepts' }).locator('.card').first().waitFor({ timeout: T });
await page.locator('.step', { hasText: 'Design concepts' }).locator('.card').first().click();
log('P1: design graph + build options');
await page.locator('.step', { hasText: 'What should the first version' }).locator('.card').first().waitFor({ timeout: T });
await assertNoError('build options');
await shot('02-design');
await page.locator('.step', { hasText: 'What should the first version' }).locator('.card').nth(1).click();
log('P1 r8..r12 + P3 (automatic)');
await page.locator('.pipeline li.ok', { hasText: 'r12_3' }).waitFor({ timeout: 4 * T });
await notBusy();
await assertNoError('process 3');
await page.waitForTimeout(800);
await shot('03-workspace');
const versions = await page.locator('.ws-right').getByRole('button', { name: /Code/ }).innerText();
log('workspace ready:', versions);

log('P4: review a test case');
await page.locator('.thumb').first().click();
await page.getByRole('button', { name: 'Something is wrong' }).click();
await page.getByText('r23 Diagnosis').waitFor({ timeout: T });
await page.locator('.review .card').first().click();
await page.getByText('Applied as a new code version (r25_4)').waitFor({ timeout: T });
await notBusy();
await assertNoError('process 4');
await shot('04-review');

log('P8: locate region in graph');
await page.getByRole('button', { name: 'Locate in graph' }).click();
await drag(60, 60, 400, 340);
await page.getByText('highlighted in the component graph').waitFor({ timeout: T });
await shot('05-locate');

log('P5: edit region');
await page.getByRole('button', { name: 'Edit region' }).click();
await drag(0, 0, 640, 60);
await page.locator('.tool-panel textarea').fill('Make the title larger and add a subtitle explaining the data is in millimetres');
await page.getByRole('button', { name: 'Propose changes' }).click();
await page.locator('.ws-left .tool-panel .card').first().waitFor({ timeout: T });
await page.locator('.ws-left .tool-panel .card').first().click();
await page.getByText(/code updated as r30_4/).waitFor({ timeout: T });
await assertNoError('process 5');
await shot('06-region');

log('P6: parameters');
await page.locator('.ws-right .tool-panel select').selectOption({ index: 2 });
await page.locator('.params').waitFor({ timeout: T });
const input = page.locator('.params input[type=number]').first();
if (await input.count()) await input.fill(String(Number(await input.inputValue()) + 4));
else await page.locator('.params input').first().fill('#e11d48');
await page.getByRole('button', { name: 'Apply parameter changes' }).click();
await page.getByText('Applied as code version r33_4').waitFor({ timeout: T });
await assertNoError('process 6');
await shot('07-params');

log('P7: sketch');
await page.getByRole('button', { name: 'Sketch', exact: true }).click();
await drag(420, 70, 620, 200);
await drag(440, 180, 600, 90); // arrow shaft
await drag(600, 90, 575, 92); // arrow head
await drag(600, 90, 596, 115);
await page.getByRole('button', { name: 'Turn sketch into code' }).click();
await page.getByText(/Merged as code version r37_4/).waitFor({ timeout: T });
await assertNoError('process 7');
await page.waitForTimeout(800);
await shot('08-sketch');

const opts = await page.locator('.ws-right').getByRole('button', { name: /Code/ }).innerText();
log('done:', opts);
await browser.close();
