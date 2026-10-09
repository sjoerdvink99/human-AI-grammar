// Browser walkthrough of all nine processes against a running server.
// Usage: PLAYWRIGHT_CHROMIUM=<path to chrome> NODE_PATH=<dir with playwright> node tests/e2e/walkthrough.cjs samples/draft.txt [http://localhost:8787]
const { chromium } = require('playwright');
const fs = require('fs');
const draft = fs.readFileSync(process.argv[2], 'utf8');
const base = process.argv[3] || 'http://localhost:8787';
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
(async () => {
  const b = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});
  const p = await b.newPage({ viewport: { width: 1500, height: 900 } });
  p.on('pageerror', (e) => log('PAGEERROR', e.message));
  const frames = [];
  p.on('request', (r) => { if (r.url().includes('/api/frame')) frames.push(Date.now()); });
  await p.goto(base);
  await p.evaluate(() => localStorage.clear());
  await p.reload();
  // P1 via UI (pasted text)
  await p.click('text=Sources');
  await p.click('summary');
  await p.fill('.modal input[placeholder=Title]', 'Ship bells note');
  await p.fill('.modal textarea', "The ship's bell was struck every half hour of a watch. Eight bells marked the end of a four-hour watch. The bell was also rung in fog as a warning to other vessels.");
  await p.click('text=Build knowledge graph');
  await p.waitForSelector('text=Knowledge graph ready', { timeout: 120000 });
  log('P1 ok', await p.textContent('.stats'));
  await p.click('.modal header .icon');
  // P9 (human modify) + P3 after the 5 s typing pause
  await p.fill('.editor-input', draft);
  const t0 = Date.now();
  await p.waitForSelector('.gap-mark', { timeout: 120000 });
  log('P3 ok highlights after', (Date.now() - t0) / 1000, 's:', await p.$$eval('.gap-mark', (m) => m.map((x) => x.textContent)));
  log('P2 frame requests so far', frames.length, 'chips:', await p.$$eval('.frame .chip', (m) => m.map((x) => x.textContent)));
  // P4: click a highlighted phrase
  const want = await p.$$eval('.gap-mark', (m) => m.findIndex((x) => /chronometer/i.test(x.textContent)));
  const target = (await p.$$('.gap-mark'))[Math.max(0, want)];
  const r = await target.boundingBox();
  await p.mouse.click(r.x + r.width / 2, r.y + r.height / 2);
  await p.waitForSelector('.popover .spinner', { timeout: 5000 }).then(() => log('P4 loading state shown')).catch(() => {});
  await p.waitForSelector('.popover .explanation', { timeout: 120000 });
  log('P4 ok card:', await p.textContent('.popover h3'), '|', (await p.textContent('.popover blockquote')).slice(0, 80));
  await p.screenshot({ path: 'tests/e2e/p4.png' });
  // P6 gold
  await p.click('.popover >> text=Add to canvas');
  await p.waitForSelector('.cnode.gold');
  log('P6 gold node ok');
  await p.click('.popover .icon');
  // P5
  await p.fill('.ask input', 'How did navigators find longitude?');
  await p.click('.ask button');
  await p.waitForSelector('.turn .answer', { timeout: 180000 });
  log('P5 ok answer:', (await p.textContent('.turn .answer')).slice(0, 160));
  log('P5 links:', await p.$$eval('.link-mark', (m) => m.map((x) => x.textContent)), 'cards:', await p.$$eval('.turn-cards h3', (m) => m.map((x) => x.textContent)));
  // P6 silver
  const addBtns = await p.$$('.turn-cards button.primary:not([disabled])');
  await addBtns[0].click();
  if (addBtns[1]) await addBtns[1].click();
  await p.waitForSelector('.cnode.silver');
  await p.waitForTimeout(2000);
  log('P6 edges:', await p.$$eval('.react-flow__edge-text', (m) => m.map((x) => x.textContent)));
  // P9 edit shifts offsets, then P7
  await p.fill('.editor-input', 'A new opening line.\n\n' + draft);
  await p.click('.cnode.gold');
  await p.waitForSelector('.origin-mark', { timeout: 5000 });
  log('P7 ok origin span:', await p.textContent('.origin-mark'));
  // P8
  await p.click('.cnode.silver');
  await p.waitForSelector('.turn.flash', { timeout: 5000 });
  log('P8 ok turn flashed');
  await p.waitForTimeout(2000);
  log('P9 frame requests total', frames.length);
  await p.screenshot({ path: 'tests/e2e/final.png' });
  await b.close();
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
