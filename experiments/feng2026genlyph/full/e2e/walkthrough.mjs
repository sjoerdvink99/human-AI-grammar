// Drives every process once in a real browser. Requires `npm run dev` running.
import { chromium } from 'playwright';
import fs from 'node:fs';

const URL = process.env.APP_URL ?? 'http://localhost:5191';
const OUT = 'e2e/shots';
fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true });
page.on('pageerror', (e) => log('PAGE ERROR', e.message));
await page.goto(URL);

// Process 1
await page.getByText('Use sample: garden plants').click();
await page.locator('.wordcloud text').first().waitFor({ timeout: 120_000 });
log('P1 keywords:', await page.locator('.kwlist b').allInnerTexts());
await page.locator('.concept .thumb svg').first().waitFor({ timeout: 300_000 });
await page.waitForFunction(() => document.querySelectorAll('.concept .spinner').length === 0, null, { timeout: 400_000 }).catch(() => log('some concepts still loading'));
log('P1 candidate images:', await page.locator('.concept .thumb').count(), 'errors:', await page.locator('.concept .error').count());
await page.screenshot({ path: `${OUT}/1-concepts.png`, fullPage: true });

// Process 2
await page.locator('.concept').first().getByText('Refine →').click();
await page.locator('textarea').fill(process.env.CONCEPT ?? 'a flower with a round centre, five separate petals, a green stem and two leaves');
await page.getByText('Generate candidates').click();
await page.locator('.pick').first().waitFor({ timeout: 300_000 });
log('P2 candidates:', await page.locator('.pick').count());
await page.screenshot({ path: `${OUT}/2-refine.png`, fullPage: true });

// Process 3
await page.locator('.pick').first().getByText('Use as prototype').click();
await page.locator('.segcanvas').waitFor();

// Process 4: draw two boxes (upper half, lower half)
const c = await page.locator('.segcanvas').boundingBox();
async function box(x0, y0, x1, y1) {
  await page.mouse.move(c.x + c.width * x0, c.y + c.height * y0);
  await page.mouse.down();
  await page.mouse.move(c.x + c.width * x1, c.y + c.height * y1, { steps: 5 });
  await page.mouse.up();
}
await box(0.05, 0.02, 0.95, 0.5);
await page.locator('.maskcard').nth(0).waitFor({ timeout: 180_000 });
await box(0.05, 0.55, 0.95, 0.98);
await page.waitForFunction(() => document.querySelectorAll('.maskcard').length >= 2 || document.querySelector('.section .error'), null, { timeout: 180_000 });
const cards = page.locator('.maskcard');
log('P4 masks:', await cards.locator('input.name').evaluateAll((els) => els.map((e) => e.value)), 'region errors:', await page.locator('.section .error').allInnerTexts());
// human modify: toggle one shape in the first mask
await cards.nth(0).getByText('Refine', { exact: true }).click();
const gid = await page.locator('.segcanvas g [data-gid]').first().getAttribute('data-gid');
await page.locator(`.segcanvas g [data-gid="${gid}"]`).first().click({ force: true });
await page.locator(`.segcanvas g [data-gid="${gid}"]`).first().click({ force: true });
await cards.nth(0).locator('select').nth(0).selectOption('family');
await cards.nth(0).locator('select').nth(1).selectOption('blooms');
if (await cards.count() > 1) await cards.nth(1).locator('select').nth(1).selectOption('height_cm');
await page.screenshot({ path: `${OUT}/3-segment.png`, fullPage: true });

// Process 5
await page.getByText('Submit components → categorical encoding').click();
await page.locator('.variant .thumb svg').first().waitFor({ timeout: 400_000 });
await page.waitForFunction(() => document.querySelectorAll('.variant .spinner').length === 0, null, { timeout: 400_000 });
log('P5 descriptions:', await page.locator('.fragment-head p:not(.muted)').allInnerTexts());
log('P5 variants:', await page.locator('.variant .thumb svg').count(), 'errors:', await page.locator('.variant .error').allInnerTexts());
// human modify: edit one prompt, regenerate
await page.locator('.variant textarea').first().fill('a deep crimson velvet petal with fine stripes');
await page.locator('.variant').first().getByText('↻ Regenerate').click();
await page.waitForFunction(() => document.querySelectorAll('.variant .spinner').length === 0, null, { timeout: 300_000 });
await page.screenshot({ path: `${OUT}/4-categorical.png`, fullPage: true });

// Process 6
await page.getByText('Continue → assembly').click();
await page.locator('.glyphgrid .glyph').first().waitFor();
const partsets = page.locator('.partset');
if (await partsets.count() > 0) await partsets.nth(0).getByText('Horizontal duplication').click();
if (await partsets.count() > 1) await partsets.nth(1).getByText('Size scaling').click();
await page.locator('.layers button').first().click().catch(() => {});
log('P6 glyphs:', await page.locator('.glyphgrid .glyph').count());
await page.screenshot({ path: `${OUT}/5-assemble.png`, fullPage: true });

// Process 7
await page.getByText('Continue → arrange').click();
await page.locator('.chip', { hasText: 'family' }).click();
await page.locator('.chip', { hasText: 'height_cm' }).click();
log('P7 recommendation:', await page.locator('.rationale').innerText());
await page.getByText('paper').click();
const g = page.locator('.fgvhost .glyph').first();
const gb = await g.boundingBox();
await page.mouse.move(gb.x + 10, gb.y + 10);
await page.mouse.down();
await page.mouse.move(gb.x + 80, gb.y + 40, { steps: 5 });
await page.mouse.up();
await page.screenshot({ path: `${OUT}/6-arrange.png`, fullPage: true });

// Process 8
const [dl] = await Promise.all([page.waitForEvent('download'), page.getByText('PNG 2×').click()]);
const file = `${OUT}/fgv@2x.png`;
await dl.saveAs(file);
log('P8 exported', file, fs.statSync(file).size, 'bytes');
await browser.close();
