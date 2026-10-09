import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRecords } from '../server/records.js';
import { selectFocusRecord, searchRecord, metricRecords, chartSpec } from '../server/tools.js';
import { extractJSON } from '../server/llm.js';

const records = loadRecords();

test('P1 tool select picks the latest day', () => {
  const r = selectFocusRecord(records);
  assert.equal(r.date, records.map((x) => x.date).sort().at(-1));
});

test('P3 tool select finds explicit dates', () => {
  const target = records[5];
  assert.equal(searchRecord(records, `what happened on ${target.date}`).record.id, target.id);
});

test('P3 tool select finds superlatives', () => {
  const min = Math.min(...records.map((r) => r.sleep_hours));
  assert.equal(searchRecord(records, 'the night I slept worst').record.sleep_hours, min);
});

test('P3 tool select matches events', () => {
  const r = records.find((x) => x.events.includes('Hiking trip'));
  if (!r) return;
  assert.ok(searchRecord(records, 'the hiking trip').record.events.includes('Hiking trip'));
});

test('P3 tool select rejects unmatched queries', () => {
  assert.throws(() => searchRecord(records, 'zzzz qqqq'));
});

test('P4 tool select and translate', () => {
  const items = metricRecords(records, 'steps');
  assert.equal(items.length, records.length);
  const spec = chartSpec(records, 'steps', items[0].id);
  assert.equal(spec.points.length, 24);
  const mood = chartSpec(records, 'mood', items[0].id);
  assert.equal(mood.points.length, records.length);
  assert.throws(() => metricRecords(records, 'nope'));
});

test('extractJSON handles fenced output', () => {
  assert.deepEqual(extractJSON('Sure:\n```json\n{"a":1}\n```'), { a: 1 });
});
