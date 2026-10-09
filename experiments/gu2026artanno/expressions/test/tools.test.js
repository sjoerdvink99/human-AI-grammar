import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tool1Extract } from '../server/tools/extract.js';
import { tool2TextEmbed, kmeans, tokenize } from '../server/tools/embeddings.js';
import { tool4ExtractLogs, tool4ExpandLogs } from '../server/tools/logs.js';
import { normalizeClusters } from '../server/processes/p2.js';
import { applyKBOps } from '../server/processes/p6.js';
import { parseJsonLoose } from '../server/llm.js';
import { generateCollection } from '../server/seed/artgen.js';
import { labelTaxonomy, leafIds } from '../server/seed/taxonomy.js';

test('tool_1 extract clamps boxes and assigns unit ids', () => {
  const { boundingBoxes, basicLabels, errors } = tool1Extract(
    [{ id: 'a', width: 100, height: 100 }],
    [{ artworkId: 'a', objects: [{ label: 'Person', bbox: [-5, 10, 50, 200] }, { label: 'x', bbox: [1, 2] }] }],
  );
  assert.deepEqual(boundingBoxes, [{ unitId: 'a-u1', artworkId: 'a', x: 0, y: 10, w: 50, h: 90 }]);
  assert.deepEqual(basicLabels, [{ unitId: 'a-u1', label: 'person' }]);
  assert.equal(errors.length, 1);
});

test('tool_2 text embeddings are normalised and similar texts are closer', () => {
  const units = [{ unitId: 'u1', artworkId: 'a' }, { unitId: 'u2', artworkId: 'a' }, { unitId: 'u3', artworkId: 'a' }];
  const d = [{ unitId: 'u1', text: 'kneeling figure in blue robe praying' }, { unitId: 'u2', text: 'kneeling figure in red robe praying' }, { unitId: 'u3', text: 'sailboat with white sail on water' }];
  const [e1, e2, e3] = tool2TextEmbed(units, d, []);
  const dot = (a, b) => a.vector.reduce((s, x, i) => s + x * b.vector[i], 0);
  assert.ok(Math.abs(dot(e1, e1) - 1) < 1e-9);
  assert.ok(dot(e1, e2) > dot(e1, e3));
  assert.deepEqual(tokenize('The Kneeling, figure!'), ['kneeling', 'figure']);
});

test('kmeans is deterministic and separates obvious groups', () => {
  const v = [[0, 0], [0, 0.1], [10, 10], [10, 10.1]];
  const a = kmeans(v, 2);
  assert.deepEqual(a, kmeans(v, 2));
  assert.equal(a[0], a[1]);
  assert.notEqual(a[0], a[2]);
});

test('normalizeClusters enforces each unit exactly once', () => {
  const { clusters, missing } = normalizeClusters([{ name: 'A', unitIds: ['u1', 'u2', 'bogus'] }, { name: 'B', unitIds: ['u2'] }], ['u1', 'u2', 'u3']);
  assert.deepEqual(clusters.map((c) => c.unitIds), [['u1', 'u2'], ['u3']]);
  assert.equal(clusters[1].name, 'Unassigned');
  assert.deepEqual(missing, ['u3']);
});

test('tool_4 extract and expand produce log records', () => {
  const run = { id: 'r', task: 't', process: 2, chosenSkills: ['s'], clusters: [{ id: 'c1', name: 'C', unitIds: ['u1', 'u2'] }] };
  const fb = [{ unitId: 'u1', verdict: 'agree' }, { unitId: 'u2', verdict: 'disagree', comment: 'no' }];
  const logs = tool4ExtractLogs({ run, clusterId: 'c1', feedback: fb, confirmed: [{ unitId: 'u1', labelId: 'L' }], recommendedLabelId: 'L' });
  assert.equal(logs[0].type, 'cluster_review');
  assert.equal(logs[0].acceptedRecommendation, true);
  assert.equal(logs[1].type, 'unit_override');
  const more = tool4ExpandLogs(logs, { chat: { focus: {}, question: 'q', answer: 'a', suggestedLabelId: null, decision: { accepted: false } } });
  assert.equal(more.length, 3);
  assert.equal(more[2].type, 'chat_decision');
});

test('model_10 operations are applied deterministically', () => {
  const kb = { entries: [{ id: 'kb-1', topic: 'a', content: 'x', source: 'seed' }, { id: 'kb-2', topic: 'b', content: 'y', source: 'seed' }] };
  const r = applyKBOps(kb, [{ op: 'add', id: '', topic: 'c', content: 'z' }, { op: 'update', id: 'kb-1', topic: '', content: 'x2' }, { op: 'remove', id: 'kb-2' }, { op: 'remove', id: 'nope' }]);
  assert.deepEqual(r.entries.map((e) => [e.id, e.content]), [['kb-1', 'x2'], ['kb-3', 'z']]);
  assert.equal(r.operations.length, 3);
});

test('parseJsonLoose handles fenced output', () => {
  assert.deepEqual(parseJsonLoose('Here:\n```json\n{"a":1}\n```'), { a: 1 });
});

test('sample collection boxes stay inside the canvas', () => {
  for (const art of generateCollection()) {
    for (const o of art.metadata.objects) {
      const [x, y, w, h] = o.bbox;
      assert.ok(x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= 640 && y + h <= 480, `${art.id} ${o.label} ${o.bbox}`);
    }
  }
  assert.ok(leafIds(labelTaxonomy).includes('figure.orant'));
});
