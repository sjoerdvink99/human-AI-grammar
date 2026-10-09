import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, extractProfile, composeLibrary, validateGuideline } from '../src/tools.js';
import { parseJsonLoose } from '../src/model.js';

test('parseCsv handles quotes and CRLF', () => {
  const rows = parseCsv('a,b\r\n"x, y","he said ""hi"""\r\n1,2\r\n');
  assert.deepEqual(rows, [{ a: 'x, y', b: 'he said "hi"' }, { a: '1', b: '2' }]);
});

test('tool_1 extract profiles CSV columns', () => {
  const r4 = extractProfile({ name: 'd.csv', format: 'csv', content: 'id,price,when,cat\n1,2.5,2026-01-01,a\n2,,2026-02-01,b\n3,4,2026-03-01,a\n' });
  assert.equal(r4.rowCount, 3);
  const byName = Object.fromEntries(r4.columns.map((c) => [c.name, c]));
  assert.equal(byName.id.type, 'integer');
  assert.equal(byName.price.type, 'float');
  assert.equal(byName.price.missing, 1);
  assert.equal(byName.price.max, 4);
  assert.equal(byName.when.type, 'datetime');
  assert.equal(byName.cat.type, 'categorical');
});

test('tool_1 extract accepts JSON arrays and rejects others', () => {
  const r4 = extractProfile({ name: 'd.json', format: 'json', content: '[{"a":1},{"a":2,"b":"x"}]' });
  assert.equal(r4.columns.length, 2);
  assert.throws(() => extractProfile({ name: 'd.json', format: 'json', content: '{"a":1}' }));
  assert.throws(() => extractProfile(null));
});

test('tool_2 compose merges and dedupes by title', () => {
  const lib = [{ id: 'g1', title: 'Show group sizes', when: '', instruction: 'x', source: 'seed' }];
  const { library, added } = composeLibrary(lib, [
    { title: 'show  group sizes', instruction: 'dup' },
    { title: 'New rule', when: 'always', instruction: 'do it' },
    { title: 'New rule', instruction: 'dup again' },
    { title: '', instruction: 'no title' },
  ]);
  assert.equal(library.length, 2);
  assert.equal(added.length, 1);
  assert.equal(library[1].source, 'suggested');
  assert.equal(lib.length, 1, 'input library not mutated');
});

test('validateGuideline requires title and instruction', () => {
  assert.throws(() => validateGuideline({ title: '', instruction: 'x' }));
  assert.throws(() => validateGuideline({ title: 'x', instruction: ' ' }));
  assert.deepEqual(validateGuideline({ title: ' T ', instruction: 'I' }), { title: 'T', instruction: 'I', when: '' });
});

test('parseJsonLoose extracts fenced JSON', () => {
  assert.deepEqual(parseJsonLoose('here:\n```json\n{"a":1}\n```'), { a: 1 });
});
