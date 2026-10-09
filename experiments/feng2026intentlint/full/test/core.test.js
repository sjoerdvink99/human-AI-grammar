import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractContext } from '../server/extract.js';
import { RuleStore } from '../server/rules.js';
import { validateTriggered, validateLint, validateProposals } from '../server/pipeline.js';
import { parseJsonReply } from '../server/llm.js';
import { diffWords, highlightPython } from '../public/util.js';

const seedRules = JSON.parse(readFileSync(new URL('../seed/rules.json', import.meta.url)));
const seedNotebook = JSON.parse(readFileSync(new URL('../seed/notebook.json', import.meta.url)));

test('tool_1 extract: imports, dataframes, variables, functions, files', () => {
  const ctx = extractContext(seedNotebook);
  assert.deepEqual(ctx.imports.map(i => i.alias), ['pd', 'np', 'plt', 'stats']);
  assert.ok(ctx.dataframes.some(d => d.name === 'customers'));
  assert.ok(ctx.dataframes.find(d => d.name === 'df').columnsUsed.includes('churned'));
  assert.ok(ctx.variables.some(v => v.name === 'CUTOFF'));
  assert.equal(ctx.functions[0].name, 'churn_rate');
  assert.deepEqual(ctx.files.sort(), ['data/customers.csv', 'data/orders.csv']);
  assert.equal(ctx.markdownNotes.length, 2);
  assert.ok(!ctx.variables.some(v => v.name === 'return'), 'indented lines are not top-level variables');
});

test('tool_2 compose: adds accepted rules, skips duplicates, broadcasts', () => {
  const store = new RuleStore(null);
  store.rules = structuredClone(seedRules);
  const events = [];
  store.onChange(e => events.push(e));
  const added = store.compose([
    { title: 'Use df_clean for plan analyses', description: 'Drop rows with missing plan first.', severity: 'warning' },
    { title: 'label every chart', description: 'dup', severity: 'info' },
  ], 'ana');
  assert.equal(added.length, 1);
  assert.equal(store.list().length, seedRules.length + 1);
  assert.equal(events[0].type, 'added');
  assert.throws(() => store.compose([{ title: '', description: 'x' }]));
});

test('process 3: editing a rule bumps its version', () => {
  const store = new RuleStore(null);
  store.rules = structuredClone(seedRules);
  const r = store.update('r-viz', { severity: 'error', description: 'Titles and labels required.' }, 'bo');
  assert.equal(r.version, 2);
  assert.equal(r.severity, 'error');
  assert.equal(r.editedBy, 'bo');
});

test('model output validation drops unknown rule ids and takes severity from the rule', () => {
  const trig = validateTriggered(seedRules)({ triggered: [{ ruleId: 'r-missing', reason: 'x' }, { ruleId: 'nope' }, { ruleId: 'r-missing' }] });
  assert.deepEqual(trig.map(t => t.ruleId), ['r-missing']);
  const lint = validateLint(trig, seedRules)({ revisedPrompt: 'p2', messages: [{ ruleId: 'r-missing', message: 'm', severity: 'info' }, { ruleId: 'r-viz', message: 'not triggered' }] });
  assert.equal(lint.messages.length, 1);
  assert.equal(lint.messages[0].severity, 'warning');
  assert.throws(() => validateLint(trig, seedRules)({ messages: [] }));
  const props = validateProposals(seedRules)({ proposals: [{ title: 'Label every chart', description: 'd' }, { title: 'New', description: 'd', severity: 'bogus' }] });
  assert.equal(props.length, 1);
  assert.equal(props[0].severity, 'warning');
});

test('parseJsonReply tolerates fences and prose', () => {
  assert.deepEqual(parseJsonReply('Here:\n```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseJsonReply('{"a":[1,2]}'), { a: [1, 2] });
});

test('diff and highlight helpers escape HTML', () => {
  assert.equal(diffWords('plot a', 'plot b'), 'plot <del>a</del><ins>b</ins>');
  assert.ok(!highlightPython('x = "<b>"').includes('<b>'));
});
