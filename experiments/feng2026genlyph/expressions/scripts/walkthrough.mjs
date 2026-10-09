// End-to-end walkthrough of all 8 processes against the running app (real model calls).
// Usage: node scripts/walkthrough.mjs [url] [screenshotDir]
import { chromium } from 'playwright';
import fs from 'node:fs';

const url = process.argv[2] || 'http://localhost:3001';
const out = process.argv[3] || '/tmp/sx-shots';
fs.mkdirSync(out, { recursive: true });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, acceptDownloads: true });
page.on('pageerror', (e) => log('PAGE ERROR', e.message));
const shot = (n) => page.screenshot({ path: `${out}/${n}.png`, fullPage: true });
const idle = async (ms = 600000) => {
  await page.waitForTimeout(500);
  await page.waitForFunction(() => !document.querySelector('.spinner'), null, { timeout: ms });
};
const err = async () => (await page.locator('.error').count()) ? await page.locator('.error').innerText() : null;

await page.goto(url);
// Process 1
await page.click('text=Load sample (fruits)');
await page.click('text=Generate keywords');
await idle();
log('keywords:', await page.locator('.wordcloud text').count(), await err());
await page.click('text=Generate images from top keywords');
await idle();
log('candidate images round 1:', await page.locator('.cell svg').count(), 'errors:', await page.locator('.cell.err').count());
await shot('1-data');
// Process 2
await page.click('text=Refine with your own concept');
await page.fill('textarea', 'a round fruit with a big leaf on top, a short stem and a visible seed in the middle');
await page.click('text=Generate 4 images');
await idle();
log('candidate images total:', await page.locator('.cell svg').count());
await shot('2-concept');
// Process 3
await page.locator('.round').first().locator('.cell:not(.err) button:has-text("Use as glyph")').first().click();
// Process 4
const box = await page.locator('.stage').boundingBox();
const k = box.width / 256;
const drag = async (x0, y0, x1, y1) => {
  await page.mouse.move(box.x + x0 * k, box.y + y0 * k);
  await page.mouse.down();
  await page.mouse.move(box.x + x1 * k, box.y + y1 * k, { steps: 5 });
  await page.mouse.up();
};
await drag(80, 5, 190, 75);
await drag(50, 90, 210, 245);
await page.click('text=/Extract masks from/');
await idle();
const masks = await page.locator('.mask').count();
log('masks:', masks, await page.locator('.mask .muted').allInnerTexts(), await err());
// modify: toggle one shape in the active mask and back
await page.click('text=Edit active mask');
await page.mouse.click(box.x + 128 * k, box.y + 160 * k);
await page.mouse.click(box.x + 128 * k, box.y + 160 * k);
// assign
await page.locator('.mask').nth(0).locator('select').nth(0).selectOption('season');
if (masks > 1) await page.locator('.mask').nth(1).locator('select').nth(1).selectOption('sugar_g');
else await page.locator('.mask').nth(0).locator('select').nth(1).selectOption('sugar_g');
await shot('3-segment');
// Process 5
await page.click('text=Build fragments');
await idle();
log('fragments:', await page.locator('.fragment').count(), await err());
await page.click('text=Generate all missing variants');
await idle();
log('variants:', await page.locator('.variant svg').count(), 'errors:', await page.locator('.variant .ph').count());
// loop: edit one prompt and regenerate
const ta = page.locator('.variant textarea').first();
await ta.fill((await ta.inputValue()) + ' Make it very bright.');
await page.locator('.variant button').first().click();
await idle();
log('versions selector shown:', await page.locator('.variant select').count());
await shot('4-fragments');
// Process 6
await page.click('text=Assemble glyphs');
await idle();
log('glyphs:', await page.locator('figure svg').count(), await err());
const ch = page.locator('fieldset select').first();
if (await ch.count()) await ch.selectOption('stretchY');
await shot('5-assemble');
// Process 7
await page.click('text=Lay out glyphs');
await page.locator('label:has-text("group by") select').selectOption('season');
await page.locator('label:has-text("x ") select').first().selectOption('calories');
await page.locator('label:has-text("y ") select').first().selectOption('vitamin_c_mg');
await page.locator('.rec').first().click();
await page.waitForTimeout(300);
log('fgv glyphs:', await page.locator('.fgv svg svg').count(), 'layout:', await page.locator('.rec.active b').innerText());
await page.locator('.rec:has-text("Grouped grid")').click();
await shot('6-layout');
// Process 8
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("PNG")')]);
await dl.saveAs(`${out}/fgv.png`);
log('exported', `${out}/fgv.png`, fs.statSync(`${out}/fgv.png`).size, 'bytes');
await browser.close();
