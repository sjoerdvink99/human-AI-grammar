import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { extractEdits, applyEdits, diffForUi } from '../server/diff.js';
import { trainOptimizer, selectPairs } from '../server/training.js';
import { STRATEGY_IDS, applyStrategies } from '../server/strategies.js';
import { extractHtml } from '../server/model.js';
import { renderHtml, closeBrowser } from '../server/render.js';
import { estimateEnergy, computeSavings } from '../server/energy.js';

after(closeBrowser);

const A = 'a\nb\nc\nd\ne\n';
const B = 'a\nB\nc\nd\nE\nf\n';

test('extractEdits finds separate edit blocks', () => {
  const edits = extractEdits(A, B).segments.filter((s) => s.type === 'edit');
  assert.equal(edits.length, 2);
  assert.equal(diffForUi(A, B)[0].removed, 'b\n');
});

test('applyEdits: all -> code_2, none -> code_1, subset -> merge', () => {
  assert.equal(applyEdits(A, B, ['e1', 'e2']), B);
  assert.equal(applyEdits(A, B, []), A);
  assert.equal(applyEdits(A, B, ['e1']), 'a\nB\nc\nd\ne\n');
});

test('trainOptimizer recovers known strategy weights', () => {
  const truth = STRATEGY_IDS.map((_, i) => 0.05 * (i + 1));
  const pairs = [];
  for (let i = 0; i < STRATEGY_IDS.length; i++)
    for (let j = i; j < STRATEGY_IDS.length; j++) {
      const x = STRATEGY_IDS.map((_, k) => (k === i || k === j ? 1 : 0));
      pairs.push({ x, savings: x.reduce((s, v, k) => s + v * truth[k], 0) });
    }
  const w = trainOptimizer(pairs, 1e-6);
  for (const s of w.strategies) assert.ok(Math.abs(s.weight - truth[STRATEGY_IDS.indexOf(s.id)]) < 1e-3);
  assert.equal(selectPairs([{ savings: 0.01 }, { savings: 0.3 }]).length, 1);
});

test('extractHtml validates model output', () => {
  assert.match(extractHtml('Sure!\n```html\n<!doctype html><html><body>x</body></html>\n```'), /^<!doctype html>/);
  assert.throws(() => extractHtml('no html here'));
});

test('render + energy: black page uses less energy than white, dark strategy saves energy', async () => {
  const white = '<html><head></head><body style="background:#fff;margin:0"><p>hi</p></body></html>';
  const eWhite = estimateEnergy(await renderHtml(white));
  const eDark = estimateEnergy(await renderHtml(applyStrategies(white, ['dark_color_scheme'])));
  assert.ok(eWhite.relative > 0.9);
  assert.ok(eDark.mW < eWhite.mW);
  assert.ok(computeSavings(eWhite, eDark).relative > 0.5);
});
