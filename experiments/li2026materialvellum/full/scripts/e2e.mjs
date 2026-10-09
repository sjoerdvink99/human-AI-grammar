// End-to-end walkthrough of the three processes (needs `npm run dev` running).
import { chromium } from 'playwright';
const URL = process.env.URL || 'http://localhost:5173';
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const shot = (p, n) => p.screenshot({ path: `screenshots/${n}.png` });
const errors = [];

async function drag(page, box, pts, scale) {
  const [x0, y0] = pts[0];
  await page.mouse.move(box.x + x0 * scale, box.y + y0 * scale);
  await page.mouse.down();
  for (const [x, y] of pts.slice(1)) await page.mouse.move(box.x + x * scale, box.y + y * scale, { steps: 3 });
  await page.mouse.up();
}

async function urban() {
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  page.on('pageerror', (e) => errors.push('urban: ' + e.message));
  await page.goto(URL);
  const svg = page.locator('section.stage svg.surface').first();
  const box = await svg.boundingBox();
  const s = box.width / 600;
  const loop = (cx, cy, r) => Array.from({ length: 30 }, (_, i) => [cx + r * Math.cos((i / 29) * 2 * Math.PI), cy + r * Math.sin((i / 29) * 2 * Math.PI)]);
  await drag(page, box, loop(170, 170, 140), s);
  await page.getByRole('button', { name: 'commercial' }).click();
  await drag(page, box, loop(430, 420, 150), s);
  await page.getByRole('button', { name: 'park' }).first().click();
  await drag(page, box, loop(430, 140, 100), s);
  await shot(page, 'urban-1-zoning');
  await page.getByRole('button', { name: /Build 3D city/ }).click();
  await page.waitForTimeout(800);
  const clay = await page.locator('svg.clay').boundingBox();
  await drag(page, clay, [[5, 5], [8, 6], [10, 8], [7, 10]], clay.width / 24);
  await drag(page, clay, [[18, 18], [19, 19], [18, 20]], clay.width / 24);
  await page.waitForTimeout(500);
  await shot(page, 'urban-2-density');
  await page.getByRole('button', { name: /Render neighborhood/ }).click();
  await page.waitForSelector('img[alt="neighborhood render"]', { timeout: 240000 });
  const ov = await page.locator('main:nth-of-type(1) svg.overlay').boundingBox();
  await page.getByRole('button', { name: /park/ }).click();
  await page.mouse.click(ov.x + 150, ov.y + 150);
  await page.getByRole('button', { name: /school/ }).click();
  await page.mouse.click(ov.x + 330, ov.y + 330);
  await page.getByRole('button', { name: /hospital/ }).click();
  await page.mouse.click(ov.x + 200, ov.y + 200);
  await page.waitForTimeout(1500);
  await shot(page, 'urban-3-magnets');
  await page.getByRole('button', { name: /Inpaint functions/ }).click();
  await page.waitForSelector('.versions', { timeout: 240000 });
  await page.waitForTimeout(500);
  await shot(page, 'urban-4-inpainted');
  const err = await page.locator('.status.error').count();
  if (err) errors.push('urban status error: ' + (await page.locator('.status.error').innerText()));
}

async function ikebana() {
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  page.on('pageerror', (e) => errors.push('ikebana: ' + e.message));
  await page.goto(URL);
  await page.getByRole('button', { name: /Ikebana/ }).click();
  const svg = page.locator('main:nth-of-type(2) svg.surface');
  const box = await svg.boundingBox();
  const s = box.width / 512;
  await page.getByRole('button', { name: '+ Flower' }).click();
  await page.getByRole('button', { name: '+ Leaf' }).click();
  // drag the shin circle (find it via its label)
  const shin = await page.locator('main:nth-of-type(2) text', { hasText: 'shin' }).boundingBox();
  await page.mouse.move(shin.x + 5, shin.y + 5); await page.mouse.down();
  await page.mouse.move(shin.x - 60, shin.y + 60, { steps: 6 }); await page.mouse.up();
  await shot(page, 'ikebana-1-arranged');
  await page.getByRole('button', { name: /Generate arrangement/ }).click();
  await page.waitForSelector('img[alt="generated arrangement"]', { timeout: 240000 });
  await shot(page, 'ikebana-2-generated');
}

async function poster() {
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  page.on('pageerror', (e) => errors.push('poster: ' + e.message));
  await page.goto(URL);
  await page.getByRole('button', { name: /Graphic poster/ }).click();
  const c = page.locator('canvas.sand');
  const box = await c.boundingBox();
  const s = box.width / 512;
  const fill = async (x0, y0, x1, y1, passes) => {
    for (let k = 0; k < passes; k++) {
      const pts = [];
      for (let y = y0; y <= y1; y += 18) { pts.push([x0, y]); pts.push([x1, y]); }
      await drag(page, box, pts, s);
    }
  };
  await fill(50, 40, 460, 110, 6); // dense title
  await fill(90, 190, 420, 400, 2); // lighter image
  await fill(60, 450, 300, 480, 3); // subtitle
  await page.getByRole('button', { name: /Push/ }).click();
  await drag(page, box, [[420, 300], [450, 300]], s);
  await shot(page, 'poster-0-sand');
  await page.getByRole('button', { name: /Label by voice/ }).click();
  const label = async (x, y, t) => {
    await page.mouse.click(box.x + x * s, box.y + y * s);
    const inp = page.locator('.voice input');
    await inp.fill(t); await inp.press('Enter');
  };
  await label(250, 75, 'this is the title');
  await label(250, 300, 'an image');
  await label(150, 465, 'subtitle please');
  await shot(page, 'poster-1-sand');
  await page.getByRole('button', { name: /Generate poster/ }).click();
  await page.waitForSelector('img[alt="poster"]', { timeout: 300000 });
  await shot(page, 'poster-2-generated');
}

const ONLY = process.env.ONLY;
const runs = { urban, ikebana, poster };
await Promise.all(Object.entries(runs).filter(([k]) => !ONLY || ONLY.split(',').includes(k)).map(([, f]) => f()).map((p) => p.catch((e) => errors.push(String(e)))));
await browser.close();
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'all processes walked through OK');
