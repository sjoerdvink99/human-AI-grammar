import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorsFromFirstPage, captionChunks, composeCreditText, looksLikeName, splitAuthorList, wrap } from './tools.ts';
import { sanitizeSvg, renderSvg } from './media.ts';

test('captionChunks covers the whole duration in order', () => {
  const c = captionChunks('Scientists found that sleeping more improves memory. It works in mice and humans alike.', 6);
  assert.ok(c.length >= 2);
  assert.equal(c[0].start, 0);
  assert.ok(Math.abs(c.at(-1)!.end - 6) < 1e-9);
  for (let i = 1; i < c.length; i++) assert.ok(Math.abs(c[i].start - c[i - 1].end) < 1e-9);
});

test('wrap keeps lines short', () => {
  for (const line of wrap('one two three four five six seven eight nine ten', 12).split('\n')) assert.ok(line.length <= 12);
});

test('author parsing', () => {
  assert.deepEqual(splitAuthorList('Ada Lovelace, Alan Turing and Grace Hopper'), ['Ada Lovelace', 'Alan Turing', 'Grace Hopper']);
  assert.ok(!looksLikeName('Stanford University'));
  const page = 'Learning to Sleep Better\nJane Doe1, John Smith2*\n1University of Somewhere\nAbstract\nWe study...';
  assert.deepEqual(authorsFromFirstPage(page, 'Learning to Sleep Better'), ['Jane Doe', 'John Smith']);
});

test('credit text', () => {
  assert.match(composeCreditText('A Paper', ['A B', 'C D']), /A Paper[\s\S]*A B, C D/);
  assert.match(composeCreditText('T', ['A A', 'B B', 'C C', 'D D', 'E E']), /et al\./);
});

test('svg sanitising and rendering', () => {
  const svg = sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>alert(1)</script><rect width="10" height="10" fill="red"/></svg>');
  assert.ok(!svg.includes('script'));
  assert.ok(renderSvg(svg, 20).length > 0);
});
