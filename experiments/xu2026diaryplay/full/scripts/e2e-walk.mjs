// End-to-end walkthrough of all six processes in a headless browser.
// Usage: PLAYWRIGHT_DIR=/dir/containing/node_modules node scripts/e2e-walk.mjs [screenshot-dir]
import { createRequire } from 'node:module';
const require = createRequire((process.env.PLAYWRIGHT_DIR || process.cwd()) + '/');
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://localhost:8790';
const shots = process.argv[2] || '.';
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const idle = async (t = 240000) => {
  await page.waitForTimeout(500);
  await page.waitForSelector('.busy', { state: 'detached', timeout: t });
  const err = await page.$('.error');
  if (err) log('ERROR', await err.textContent());
};

await page.goto(BASE);
await page.evaluate(() => localStorage.clear());
await page.reload();
// Process 1
await page.click('text=Use sample story');
await page.click('text=Analyse story');                        // P1.1–P1.3
await idle();
log('characters', await page.$$eval('.charcard summary', (s) => s.map((x) => x.textContent)));
const labels = await page.$$('label.row input');
log('room labels', await Promise.all(labels.map((l) => l.inputValue())));
await labels[0].fill((await labels[0].inputValue()) + ' corner'); // P1.4
await page.click('text=Generate & place objects');             // P1.5–P1.7
await idle();
log('objects', await page.$$eval('.envobj title', (t) => t.map((x) => x.textContent)));
await page.screenshot({ path: `${shots}/1-build.png`, fullPage: true });
for (let i = 0; i < (await page.$$('.envobj')).length; i++) { // P1.8 drag: try objects until one moves
  const o = (await page.$$('.envobj'))[i];
  const before = await o.getAttribute('transform');
  const b = await o.boundingBox();
  await page.mouse.move(b.x + 8, b.y + 8); await page.mouse.down(); await page.mouse.move(b.x + 8, b.y + 70, { steps: 5 }); await page.mouse.up();
  const after = await (await page.$$('.envobj'))[i].getAttribute('transform');
  if (after !== before) { log('dragged object', i, before, '->', after); break; }
}
log('after drag:', await page.textContent('.envwrap .hint'));
await page.locator('.charcard summary').first().click();
await page.locator('.charcard textarea').nth(1).fill('Warm, observant, a little nostalgic.'); // P1.9
// Process 2
await page.click('text=2 · Persona lab');
await page.fill('input[placeholder^="Say something"]', 'What are you cooking tonight?'); // P2.1
await page.click('button:has-text("Send")');                    // P2.2
await idle();
const reply = page.locator('.round textarea');
log('reply', await reply.inputValue());
await reply.fill('Your favourite, cariño! Minestrone, like my mother made. Now go wash your hands.'); // P2.3
await page.click('text=Suggest traits');                        // P2.4
await idle();
log('traits', await page.$$eval('.chip', (c) => c.map((x) => x.textContent)));
await page.locator('.chip').first().click();                    // P2.5
await page.click('button:has-text("Apply to")');                // P2.6
log('persona card', (await page.textContent('.col .card:nth-child(2)')).replace(/\s+/g, ' '));
await page.screenshot({ path: `${shots}/2-persona.png`, fullPage: true });
// Process 3
await page.click('text=3 · Key events');
await page.click('text=Extract key events');                    // P3.1–P3.3
await idle();
log('events', await page.$$eval('.evtitle', (e) => e.map((x) => x.value)));
const firstAction = page.locator('table.acts input').first();
await firstAction.fill((await firstAction.inputValue()) + ' carefully'); // P3.4
await page.screenshot({ path: `${shots}/3-events.png`, fullPage: true });
await page.click('text=Complete vignette');                     // P3.5
await idle();
const link = await page.getAttribute('a:has-text("Play the vignette")', 'href');
log('play link', link);
// Processes 4–6
await page.goto(BASE + '/' + link);
await page.waitForSelector('canvas');                           // P4.1
const v = await (await fetch(`${BASE}/api/vignettes/${link.split('/').pop()}`)).json();
const player = v.characters.find((c) => c.isPlayer);
await page.check('text=Show NPC plans');
const cb = await (await page.$('canvas')).boundingBox();
const scale = cb.width / (v.environment.width * 36);
const clickTile = (x, y) => page.mouse.click(cb.x + (x + 0.5) * 36 * scale, cb.y + (y + 0.5) * 36 * scale);
await page.waitForSelector('.plan', { timeout: 120000 });       // P4.2
log('plans', await page.$$eval('.plan', (p) => p.map((x) => x.textContent)));
const side = async () => (await page.textContent('.side .card')).replace(/\s+/g, ' ');

// wait until the player has a part in the current event, then diverge: P4.3 -> P6.1 -> P6.2 -> P6.3, P4.4, P4.5
const curEvent = async () => v.events[Number(((await page.evaluate(() => document.querySelector('.side .card p b')?.textContent)) || '1/').split('/')[0]) - 1];
for (let i = 0; i < 20; i++) {
  const ev = await curEvent();
  if (ev && ev.activityIds.some((id) => v.activities.find((a) => a.id === id).characterId === player.id)) break;
  await page.waitForTimeout(3000);
}
const evD = await curEvent();
const mine = new Set(evD.activityIds.map((id) => v.activities.find((a) => a.id === id)).filter((a) => a.characterId === player.id).map((a) => a.objectId));
const other = v.environment.objects.find((x) => !mine.has(x.id) && x.pos);
log('diverging during', evD.title, 'by using', other.name);
await clickTile(other.pos.x, other.pos.y);
await page.waitForSelector('.menu', { timeout: 15000 });
await page.locator('.menu button').first().click();
await page.waitForSelector('.voice', { timeout: 120000 }).catch(() => {});
await page.waitForTimeout(1500);
log('after diverge:', await side(), '| inner voice:', await page.$$eval('.voice', (x) => x.map((y) => y.textContent)));
await page.screenshot({ path: `${shots}/4-diverge.png` });

// Process 5: walk next to an NPC (clicking it) and talk
const npc = v.characters.find((c) => !c.isPlayer);
const pos = (await page.evaluate(() => window.__positions()))[npc.id];
await clickTile(pos.x, pos.y);
await page.waitForSelector('.chat', { timeout: 15000 }).catch(() => {});
if (await page.$('.chat')) {
  await page.fill('.chat input', "Let's skip all this and just go home, ok?"); // P5.1
  await page.keyboard.press('Enter');                                          // P5.2
  await page.waitForSelector('.chat .them', { timeout: 120000 });
  log('npc reply:', await page.textContent('.chat .them'));                    // P5.3 bubble on canvas
  await page.screenshot({ path: `${shots}/5-chat.png` });
  await page.click('.chat h3 button');
} else log('could not open chat');

// follow the key events to the end (the P4 loop)
for (let round = 0; round < 30; round++) {
  if (await page.$('.endscreen')) break;
  const idx = await page.evaluate(() => document.querySelector('.side .card p b')?.textContent);
  const ev = v.events[Number((idx || '1/').split('/')[0]) - 1];
  if (!ev) { await page.waitForTimeout(3000); continue; }
  const logText = await page.evaluate(() => [...document.querySelectorAll('.log li')].map((l) => l.textContent).join('\n'));
  const pending = ev.activityIds.map((id) => v.activities.find((a) => a.id === id))
    .filter((a) => a.characterId === player.id && !logText.includes(`${player.name}: ${a.action}`));
  if (!pending.length) { await page.waitForTimeout(4000); continue; }
  const a = pending[0];
  if (a.objectId) {
    const ob = v.environment.objects.find((x) => x.id === a.objectId);
    await clickTile(ob.pos.x, ob.pos.y);
    try { await page.waitForSelector('.menu', { timeout: 15000 }); } catch { log('no menu for', ob.name); continue; }
    await page.locator('.menu button').first().click();
  } else {
    await page.keyboard.press('q');
    await page.locator('.menu button', { hasText: a.action }).first().click();
  }
  log('player did:', a.action);
  await page.waitForTimeout(10000);
  log('  ', await side());
}
await page.waitForSelector('.endscreen', { timeout: 120000 }).catch(() => log('no end screen'));
await page.screenshot({ path: `${shots}/6-end.png` });
log('end screen shown:', !!(await page.$('.endscreen')));
await browser.close();
