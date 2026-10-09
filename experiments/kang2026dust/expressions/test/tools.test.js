import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectHighlight, selectByInterest, filterHighlights, filterOptions, ALL_SOURCES } from '../server/tools.js';
import { extractJson } from '../server/model.js';

const hs = [
  { id: 'a', text: 'Simplify, simplify.', source: 'Walden', author: 'Thoreau', lastSurfacedAt: '2026-01-02' },
  { id: 'b', text: 'Nothing is so painful as a great and sudden change.', source: 'Frankenstein', author: 'Shelley', lastSurfacedAt: '2026-01-01' },
  { id: 'c', text: 'Life speeds by while we are postponing.', source: 'Letters', author: 'Seneca', lastSurfacedAt: null },
];

test('selectHighlight picks least recently surfaced', () => {
  assert.equal(selectHighlight(hs).id, 'c');
  assert.equal(selectHighlight(hs, { excludeId: 'c' }).id, 'b');
});

test('selectByInterest matches terms', () => {
  assert.equal(selectByInterest(hs, 'dealing with changes').highlight.id, 'b');
  assert.equal(selectByInterest(hs, 'postponing things').highlight.id, 'c');
});

test('selectByInterest excludes the current remix highlight and falls back', () => {
  const r = selectByInterest(hs, 'change', { excludeId: 'b' });
  assert.notEqual(r.highlight.id, 'b');
  assert.equal(r.score, 0);
});

test('filterHighlights by source', () => {
  assert.deepEqual(filterOptions(hs), [ALL_SOURCES, 'Frankenstein', 'Letters', 'Walden']);
  assert.equal(filterHighlights(hs, ALL_SOURCES).length, 3);
  assert.deepEqual(filterHighlights(hs, 'Walden').map((h) => h.id), ['a']);
});

test('extractJson handles fences and prose', () => {
  assert.deepEqual(extractJson('Sure!\n```json\n{"keywords":["a"]}\n```'), { keywords: ['a'] });
  assert.deepEqual(extractJson('here {"text":"x"} done'), { text: 'x' });
});
