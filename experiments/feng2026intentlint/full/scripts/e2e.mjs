// End-to-end smoke test: drives the running UI over the Chrome DevTools Protocol,
// walks through processes 1-4 and saves screenshots to ./screenshots.
// Usage: node --experimental-websocket scripts/e2e.mjs <chrome-binary> http://localhost:5173/
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
const [bin, url] = process.argv.slice(2);
mkdirSync('screenshots', { recursive: true });
const chrome = spawn(bin, ['--remote-debugging-port=9333', '--window-size=1400,1000', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let targets;
for (let i = 0; i < 50; i++) { try { targets = await (await fetch('http://127.0.0.1:9333/json')).json(); break; } catch { await sleep(200); } }
const page = targets.find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => (ws.onopen = r));
let id = 0; const pending = new Map(); const errors = [];
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(JSON.stringify(m.params.args.map(a => a.value)));
};
const cdp = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async expr => (await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
const waitFor = async (expr, ms = 240000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(expr)) return; await sleep(500); } throw new Error('timeout: ' + expr); };
const shot = async name => { const r = await cdp('Page.captureScreenshot', { format: 'png' }); writeFileSync(`screenshots/${name}.png`, Buffer.from(r.result.data, 'base64')); };

try {
  await cdp('Runtime.enable'); await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url });
  await waitFor(`document.querySelectorAll('.cell').length > 0 && document.querySelectorAll('#rules .rule').length > 0`, 10000);
  console.log('loaded; cells', await ev(`document.querySelectorAll('.cell').length`), 'rules', await ev(`document.querySelectorAll('#rules .rule').length`));

  // Process 1: specify -> extract -> match -> modify -> select -> generate
  await ev(`document.querySelector('#prompt').value = 'Plot churn rate by region'; document.querySelector('#submit').click(); true`);
  await waitFor(`!document.querySelector('#lint-card').classList.contains('hidden')`);
  console.log('lint card; messages', await ev(`document.querySelectorAll('.lint').length`), 'triggered chips', await ev(`document.querySelectorAll('#triggered .chip').length`));
  await waitFor(`document.querySelector('[data-stage=propose]').className !== 'running'`);
  console.log('stages', await ev(`[...document.querySelectorAll('#stages li')].map(l => l.dataset.stage + ':' + l.className).join(' ')`));
  await shot('1-lint');
  await ev(`document.querySelector('#use-revised').click(); true`);
  await waitFor(`!document.querySelector('#insert-code').disabled`);
  const before = await ev(`document.querySelectorAll('.cell').length`);
  await ev(`document.querySelector('#insert-code').click(); true`);
  console.log('cells', before, '->', await ev(`document.querySelectorAll('.cell').length`));
  await shot('2-code');

  // Process 2: generate -> modify -> select -> compose
  const nProps = await ev(`document.querySelectorAll('.proposal').length`);
  console.log('proposals', nProps);
  if (nProps) {
    await ev(`(() => { const p = document.querySelector('.proposal'); const t = p.querySelector('.title'); t.value += ' (edited)'; t.dispatchEvent(new Event('input')); const c = p.querySelector('input[type=checkbox]'); c.checked = true; c.dispatchEvent(new Event('change')); return true })()`);
    const n = await ev(`document.querySelectorAll('#rules .rule').length`);
    await ev(`document.querySelector('#share-proposals').click(); true`);
    await waitFor(`document.querySelectorAll('#rules .rule').length > ${n}`, 10000);
    console.log('rules after share', await ev(`document.querySelectorAll('#rules .rule').length`), 'edited title kept', await ev(`[...document.querySelectorAll('.rule-title')].some(t => t.textContent.includes('(edited)'))`));
  }

  // Process 3: edit a shared rule; Process 4: deactivate one locally
  await ev(`document.querySelector('[data-tab=board]').click(); true`);
  await ev(`document.querySelector('#rules .rule .edit').click(); true`);
  await ev(`(() => { const r = document.querySelector('#rules .rule'); r.querySelector('.desc').value += ' Edited in test.'; r.querySelector('.sev').value = 'info'; r.querySelector('.save').click(); return true })()`);
  await waitFor(`[...document.querySelectorAll('.rule-meta')].some(m => m.textContent.includes('edited by'))`, 10000);
  console.log('rule edit applied');
  await ev(`(() => { const s = document.querySelector('#rules .rule .switch input'); s.checked = false; s.dispatchEvent(new Event('change')); return true })()`);
  console.log('inactive rules', await ev(`document.querySelectorAll('#rules .rule.inactive').length`), 'active count', await ev(`document.querySelector('#active-count').textContent`));
  await shot('3-board');
  console.log('page errors', errors);
} finally {
  ws.close(); chrome.kill();
}
process.exit(errors.length ? 1 : 0);
