import test from 'node:test';
import assert from 'node:assert/strict';
process.env.MODEL_PROVIDER = 'mock';
const { sanitizeSvg, tagElements, extractSvg } = await import('../server/svg.mjs');
const { app } = await import('../server/index.mjs');

test('svg validation strips unsafe content and tags shapes', () => {
  const raw = 'Sure!\n```svg\n<svg width="100" height="50"><script>x</script><defs><linearGradient id="a"><stop/></linearGradient></defs><rect onclick="x" width="5" height="5"/><g><circle r="3"/></g><image href="http://x"/></svg>\n```';
  const s = tagElements(sanitizeSvg(extractSvg(raw)));
  assert.ok(!/script|onclick|image/.test(s));
  assert.match(s, /viewBox="0 0 100 50"/);
  assert.equal((s.match(/data-eid/g) || []).length, 2);
});

test('model endpoints (mock provider)', async () => {
  const server = app.listen(0);
  const base = `http://localhost:${server.address().port}/api`;
  const post = (p, b) => fetch(`${base}/${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
  try {
    assert.match((await post('keywords', { description: 'x' })).text, /apple \| 9/);
    assert.match((await post('image', { prompt: 'x' })).svg, /data-eid="e1"/);
    const seg = await post('segment', { svg: '<svg/>', elements: [{ eid: 'e0', tag: 'circle', bbox: [0, 0, 1, 1] }], regions: [{ x: 0, y: 0, w: 1, h: 1 }] });
    assert.deepEqual(seg.masks[0].eids, ['e0']);
    assert.equal((await post('describe', { glyphSvg: '', fragments: [{ name: 'a', attribute: 'b', svg: '' }] })).descriptions.length, 1);
    assert.match((await post('variant', { fragmentSvg: '<svg/>', viewBox: '1 2 3 4', prompt: 'x' })).svg, /viewBox="1 2 3 4"/);
  } finally {
    server.close();
  }
});
