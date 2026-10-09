import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateStep } from './evaluateStep.ts';
import { therapyFramework, allVariableNames } from '../framework.ts';
import { alignLyrics, parseLyricLines } from './alignLyrics.ts';
import { fitSegments } from './transcribe.ts';
import { extractBeats } from './beats.ts';

const empty = () => Object.fromEntries(allVariableNames.map((n) => [n, null as string | null]));

test('tool_1 evaluate: in_progress → step_complete → all_complete', () => {
  const v = empty();
  const s0 = evaluateStep(therapyFramework, v);
  assert.equal(s0.status, 'in_progress');
  assert.equal(s0.current_step, 0);
  v.preferred_name = 'Sam';
  v.current_mood = 'tired';
  const s1 = evaluateStep(therapyFramework, v, s0);
  assert.equal(s1.status, 'step_complete');
  assert.equal(s1.current_step, 1);
  for (const n of allVariableNames) v[n] = 'x';
  assert.equal(evaluateStep(therapyFramework, v, s1).status, 'all_complete');
});

test('tool_3 match: aligns lyric lines to transcript words, skipping headers', () => {
  const lyrics = '[Verse 1]\nhello there\n[Chorus]\nstill here';
  assert.equal(parseLyricLines(lyrics).length, 2);
  const tl = alignLyrics(lyrics, {
    engine: 't',
    segments: [
      { text: 'hello there', start: 1, end: 2, words: [{ word: 'Hello', start: 1, end: 1.5 }, { word: 'there', start: 1.5, end: 2 }] },
      { text: 'still here!', start: 3, end: 4, words: [{ word: 'still', start: 3, end: 3.5 }, { word: 'here!', start: 3.5, end: 4 }] },
    ],
  });
  assert.deepEqual(tl.lines.map((l) => [l.start, l.end, l.section]), [[1, 2, 'Verse 1'], [3, 4, 'Chorus']]);
});

test('tool_2 VAD segments are merged/split to the expected count', () => {
  assert.equal(fitSegments([[0, 1], [1.05, 2], [3, 4]], 2).length, 2);
  assert.deepEqual(fitSegments([[0, 1], [1.05, 2], [3, 4]], 2)[0], [0, 2]);
  assert.equal(fitSegments([[0, 4]], 3).length, 3);
});

test('tool_4 extract: finds beats of a click track at 120 bpm', () => {
  const sr = 22050;
  const x = new Float32Array(sr * 10);
  for (let b = 0; b < 20; b++) for (let i = 0; i < 400; i++) x[Math.floor(b * 0.5 * sr) + i] = Math.sin(i * 0.3) * Math.exp(-i / 80);
  const beats = extractBeats(x, sr);
  const gaps = beats.slice(1, 10).map((b, i) => b.time - beats[i].time);
  for (const g of gaps) assert.ok(Math.abs(g - 0.5) < 0.05, `gap ${g}`);
  assert.ok(Math.abs(beats[0].time % 0.5) < 0.1 || Math.abs((beats[0].time % 0.5) - 0.5) < 0.1);
});
