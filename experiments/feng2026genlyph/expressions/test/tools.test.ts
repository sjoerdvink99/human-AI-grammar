import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseCsv, extractAttributes, describeDataset } from '../web/src/tools/attributes.ts';
import { parseKeywords, composeImagePrompts, composeEncodingPrompts } from '../web/src/tools/prompts.ts';
import { recommendLayouts, composeFGV } from '../web/src/tools/layout.ts';
import { convexHull } from '../web/src/tools/contours.ts';
import { prefixIds } from '../web/src/tools/svgutil.ts';

const ds = parseCsv(fs.readFileSync('data/fruits.csv', 'utf8'), 'fruits');
const attrs = extractAttributes(ds);

test('csv + attributes', () => {
  assert.equal(ds.rows.length, 16);
  assert.equal(attrs.find((a) => a.name === 'name')!.kind, 'id');
  assert.deepEqual(attrs.find((a) => a.name === 'season')!.categories, ['Autumn', 'Spring', 'Summer', 'Winter']);
  assert.equal(attrs.find((a) => a.name === 'calories')!.max, 122);
  assert.match(describeDataset(ds, attrs), /season: categorical/);
});

test('keywords parsing and prompt composition', () => {
  const k = parseKeywords('Here:\n1. Apple | 9\n- leaf|7\nnonsense\napple | 3');
  assert.deepEqual(k.map((x) => x.text), ['apple', 'leaf']);
  assert.equal(composeImagePrompts(k, 'fruits', 4).length, 2);
  const p = composeEncodingPrompts([{ maskId: 'm1', name: 'leaf', attribute: 'season', svg: '', inner: '', edge: { x: 0, y: 0, w: 1, h: 1 } }], attrs);
  assert.equal(p.length, 4);
  assert.match(p[0].prompt, /season = "Autumn"/);
});

test('layout matching and composition', () => {
  const rec = recommendLayouts({ xAttr: 'calories', yAttr: 'sugar_g', sortAttr: '', groupAttr: 'season', labelAttr: 'name', glyphSize: 40, width: 600 }, attrs, ds);
  assert.equal(rec[0].type, 'scatter');
  assert.ok(rec.some((r) => r.type === 'groupedGrid'));
  const glyphs = ds.rows.map((_, i) => ({ rowIndex: i, viewBox: '0 0 256 256', svgInner: '<circle cx="128" cy="128" r="50"/>' }));
  for (const type of ['grid', 'sortedGrid', 'groupedGrid', 'scatter', 'circular'] as const) {
    const svg = composeFGV(glyphs, ds, attrs, { xAttr: 'calories', yAttr: 'sugar_g', sortAttr: 'price_per_kg', groupAttr: 'season', labelAttr: 'name', glyphSize: 40, width: 600 }, { type, padding: 6, showLabels: true, showAxes: true });
    assert.equal((svg.match(/<circle/g) || []).length, 16, type);
  }
});

test('convex hull and id prefixing', () => {
  assert.equal(convexHull([[0, 0], [2, 0], [1, 1], [2, 2], [0, 2]]).length, 4);
  assert.equal(prefixIds('<linearGradient id="a"/><rect fill="url(#a)"/>', 'v1'), '<linearGradient id="v1-a"/><rect fill="url(#v1-a)"/>');
});
