import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extractContext, composeRules, parseColumns } from '../server/tools.js';
import { SAMPLE_NOTEBOOK, DEFAULT_RULES } from '../server/sample.js';
import { RulesStore } from '../server/rulesStore.js';

test('tool_1 extract: dataframes, columns, imports from sample notebook', () => {
  const c = extractContext(SAMPLE_NOTEBOOK);
  assert.ok(c.imports.includes('import pandas as pd'));
  const sales = c.dataframes.find((d) => d.name === 'sales');
  assert.ok(sales);
  for (const col of ['order_date', 'region', 'unit_price', 'discount', 'revenue']) assert.ok(sales.columns.includes(col), col);
  assert.equal(c.variables.find((v) => v.name === 'sales').kind, 'DataFrame');
  assert.ok(c.headings.includes('Store sales analysis'));
});

test('parseColumns reads Index output', () => {
  assert.deepEqual(parseColumns("Index(['a', 'b'], dtype='object')"), ['a', 'b']);
});

test('tool_2 compose: adds new rules with fresh ids, merges by name, validates', () => {
  const { rules, added } = composeRules(DEFAULT_RULES, [
    { name: 'New rule', condition: 'c', guidance: 'g', severity: 'warning' },
    { name: 'name the data', condition: 'c2', guidance: 'g2', severity: 'info' },
  ]);
  assert.equal(rules.length, DEFAULT_RULES.length + 1);
  assert.equal(added[0], 'r6');
  assert.equal(rules.find((r) => r.id === 'r1').condition, 'c2');
  assert.throws(() => composeRules([], [{ name: 'x' }]));
});

test('rules store keeps versions and active selection', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sx-')), 'rules.json');
  const s = new RulesStore(file);
  assert.equal(s.state().version, 1);
  s.setActive(['r1']);
  assert.deepEqual(s.activeRules().map((r) => r.id), ['r1']);
  const { rules, added } = composeRules(s.current().rules, [{ name: 'Z', condition: 'c', guidance: 'g' }]);
  s.commit(rules, 'test', added);
  assert.equal(s.state().version, 2);
  assert.deepEqual(s.state().active, ['r1', 'r6']);
  s.revert(1);
  assert.equal(s.state().version, 3);
  assert.equal(s.state().rules.length, 5);
});
