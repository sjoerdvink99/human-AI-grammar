// End-to-end walkthrough of all 8 processes in a headless browser. Run with the dev servers up:
//   npm run dev   (in another terminal)   then   node scripts/e2e.mjs
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:5173';
const shot = (page, n) => page.screenshot({ path: `shots/${n}.png`, fullPage: true });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
page.on('console', (m) => m.type() === 'error' && log('console error:', m.text()));
page.on('response', (r) => r.status() >= 500 && r.text().then((t) => log('500', r.url(), t.slice(0, 300))));
page.on('pageerror', (e) => log('page error:', e.message));
await page.goto(BASE);
await page.request.post(`${BASE}/api/project/reset`);
await page.reload();

// ---- Process 1: generate scripts + render + version
log('P1 generate');
await page.getByRole('button', { name: /Generate scripts & render/ }).click();
await page.waitForSelector('video.player', { timeout: 400_000 });
log('P1 video rendered; codec:', await page.evaluate(async () => (await VideoEncoder.isConfigSupported({ codec: 'avc1.4d0029', width: 960, height: 540 })).supported ? 'avc' : 'fallback'));
await shot(page, '1-story');

// ---- Process 2: focus a scene -> guidance
log('P2 guidance');
await page.getByRole('button', { name: 'Guidance' }).nth(1).click();
await page.waitForSelector('.guidance .guideline-focus');
log('P2 guideline:', await page.textContent('.guideline-focus strong'));

// ---- Process 3: evaluate, modify, re-render
log('P3 assess + modify + re-render');
await page.fill('.assessment textarea', 'Second scene is too long; shorten it.');
await page.getByRole('button', { name: 'Save assessment' }).click();
await page.getByRole('button', { name: 'Edit' }).nth(1).click();
await page.locator('.scene-editor input[type=number]').first().fill('4');
await page.locator('.scene-editor input').first().fill('Then vs now');
await page.getByRole('button', { name: /Re-render with edited scripts/ }).click();
await page.waitForFunction(() => document.querySelector('.videop h2')?.textContent?.includes('version 2'), null, { timeout: 300_000 });
log('P3 version 2 rendered');

// ---- Process 4: clip
log('P4 clip');
await page.getByRole('button', { name: 'Generate clip' }).first().click();
await page.waitForSelector('img.clip', { timeout: 400_000 });
await shot(page, '2-story-guidance-clip');

// ---- Process 5: chart
log('P5 chart');
await page.getByRole('button', { name: 'Chart', exact: true }).click();
await page.getByRole('button', { name: 'bar', exact: true }).click();
await page.waitForTimeout(2500);
await shot(page, '3-chart');

// ---- Processes 6 & 7: compose
for (const mode of ['full', 'shape']) {
  log(`P${mode === 'full' ? 6 : 7} compose ${mode}`);
  await page.getByRole('button', { name: 'Compose', exact: true }).click();
  await page.getByRole('button', { name: mode === 'full' ? 'Replace object with chart' : 'Place chart in a drawn region' }).click();
  await page.evaluate(() => { const v = document.querySelector('.compose video.player'); v.currentTime = 3; });
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: 'Use this frame' }).click();
  const picker = page.locator('.picker').first();
  await picker.waitFor();
  const box = await picker.boundingBox();
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.45); // the big number / main visual
  await page.waitForSelector('.picker polygon', { timeout: 300_000 });
  log('mask:', await page.locator('.compose p.muted strong').first().textContent());
  await page.getByRole('button', { name: 'Remove object from video' }).click();
  await page.waitForSelector('.compose-grid section:nth-child(3) video', { timeout: 300_000 });
  log('cleaned');
  if (mode === 'shape') {
    const rp = page.locator('.picker.crosshair');
    await rp.waitFor();
    const b = await rp.boundingBox();
    await page.mouse.move(b.x + b.width * 0.55, b.y + b.height * 0.2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width * 0.95, b.y + b.height * 0.75, { steps: 5 });
    await page.mouse.up();
  }
  await page.getByRole('button', { name: 'Compose chart into video' }).click();
  await page.waitForSelector('.result video', { timeout: 300_000 });
  // seek result into the edited scene for the screenshot
  await page.evaluate(() => { const v = document.querySelector('.result video'); v.pause(); v.currentTime = 3.5; });
  await page.waitForTimeout(800);
  await shot(page, `4-compose-${mode}`);
}

// ---- Process 8: versions review
log('P8 versions');
await page.getByRole('button', { name: /Versions/ }).click();
await page.locator('.version-card').first().click();
await page.fill('.review textarea', 'Tighter pacing than v1; the comparison reads well.');
await page.getByRole('button', { name: 'Save review' }).click();
await page.waitForSelector('text=saved');
await shot(page, '5-versions');
const proj = await (await page.request.get(`${BASE}/api/project`)).json();
log('versions:', proj.versions.length, 'assessment:', !!proj.versions[0].assessment, 'review:', !!proj.versions.at(-1).review, 'composites:', proj.composites.length);
await browser.close();
