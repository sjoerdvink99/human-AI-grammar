import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHighlights } from '../lib/highlights.js';
import { setModelProvider } from '../lib/model.js';
import { Store } from '../lib/store.js';
import { Service } from '../lib/service.js';
import { mondayOf, addWeeks, validateKeywords, normalizeInterest, selectHighlight } from '../lib/steps.js';

const SAMPLE = 'Quiet is a kind of music.\n— Ann Author, Book One\n\nThe river remembers every stone it carried.\n— Ben Writer, Book Two\n\nA third line about lanterns.';

test('parse plain, clippings, csv, json', () => {
  const plain = parseHighlights(SAMPLE, 'x.txt');
  assert.equal(plain.length, 3);
  assert.equal(plain[0].author, 'Ann Author');
  assert.equal(plain[0].book, 'Book One');
  const clip = parseHighlights('My Book (Jane Doe)\n- Your Highlight on Location 10-12 | Added on Monday\n\nSome text here.\n==========\nMy Book (Jane Doe)\n- Your Bookmark on Location 3\n\n\n==========\n');
  assert.equal(clip.length, 1);
  assert.equal(clip[0].author, 'Jane Doe');
  const csv = parseHighlights('text,book,author\n"Hello, world",B,A\n', 'h.csv');
  assert.equal(csv[0].text, 'Hello, world');
  const json = parseHighlights('[{"text":"t","book":"b","author":"a"}]', 'h.json');
  assert.equal(json[0].book, 'b');
});

test('weeks start on Monday', () => {
  assert.equal(mondayOf(new Date(2026, 10, 25)), '2026-11-23');
  assert.equal(mondayOf(new Date(2026, 10, 23)), '2026-11-23');
  assert.equal(mondayOf(new Date(2026, 10, 29)), '2026-11-23');
  assert.equal(addWeeks('2026-11-23', 1), '2026-11-30');
});

test('keyword validation enforces three hints, no quoting, interest included', () => {
  const h = { text: 'The river remembers every stone it carried.' };
  assert.deepEqual(validateKeywords(['Memory', 'stone', 'current', 'extra'], h), ['memory', 'stone', 'current']);
  assert.throws(() => validateKeywords(['river remembers every stone', 'a'], h));
  const withInterest = validateKeywords(['memory', 'stone', 'current'], h, 'jazz');
  assert.ok(withInterest.includes('jazz'));
  assert.equal(withInterest.length, 3);
  assert.equal(normalizeInterest(' Jazz. '), 'jazz');
  assert.throws(() => normalizeInterest('two words'));
});

test('selection prefers unseen highlights', () => {
  const hs = [{ id: 'a' }, { id: 'b' }];
  assert.equal(selectHighlight(hs, new Set(['a'])).id, 'b');
  assert.ok(selectHighlight(hs, new Set(['a', 'b'])));
});

test('full flow: processes 1-4 with a stub model', async () => {
  const prompts = [];
  setModelProvider(async (p) => {
    prompts.push(p);
    if (p.includes('"keywords"')) return '{"keywords": ["stillness", "echo", "drift"]}';
    return p.includes('DIFFERENT') ? 'A second, different remix of my thought and the passage.' : 'A remix weaving my thought with the passage.';
  });
  const svc = new Service(new Store(null));
  svc.upload(SAMPLE, 'x.txt');

  // process 1
  const s = await svc.state();
  assert.deepEqual(s.week.keywords, ['stillness', 'echo', 'drift']);
  assert.equal(s.week.highlight, null, 'quote hidden before reflecting');
  const w = await svc.respond('I have been thinking about slowing down.');
  assert.ok(w.remix.startsWith('A remix'));
  assert.ok(w.highlight.text, 'quote revealed with remix');
  assert.ok(prompts.at(-1).includes('slowing down'));

  // process 2: once only
  const w2 = await svc.retry();
  assert.ok(w2.alternativeRemix.includes('different'));
  await assert.rejects(() => svc.retry());

  // process 3
  const next = await svc.setInterest('Gardens');
  assert.equal(next.interest, 'gardens');
  assert.ok(prompts.at(-1).includes('"gardens"'));
  const nextWeek = svc.store.week(addWeeks(s.weekKey, 1));
  assert.ok(nextWeek.keywords.includes('gardens'));
  assert.notEqual(nextWeek.highlightId, svc.store.week(s.weekKey).highlightId);

  // process 4: future week not visible, filter works
  assert.equal(svc.archive('remixed').length, 1);
  assert.equal(svc.archive('all').length, 3);
  const opened = svc.archive('remixed')[0];
  assert.equal(opened.weeks[0].remix, w.remix);

  // advancing the clock surfaces next week's prepared highlight
  svc.advanceToNextMonday();
  const s2 = await svc.state();
  assert.ok(s2.week.keywords.includes('gardens'));
  assert.equal(s2.week.interest, 'gardens');
  setModelProvider(null);
});
