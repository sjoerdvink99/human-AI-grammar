import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { tool1Extract, tool2EmbedCaptions, tool3EmbedGuidelines, similarities, tool4Extract, tool4Expand, oneOf, clamp01, byImage } from '../server/tools.js';
import { extractJson } from '../server/llm.js';
import { buildDemo, DEMO_GUIDELINES } from '../server/demo.js';

test('tool_1 extract turns annotations into regions and object labels', () => {
  const { regions, objectLabels } = tool1Extract(
    [{ id: 'a' }, { id: 'b' }],
    [{ imageId: 'a', objects: [{ label: 'Car', bbox: [1, 2, 3, 4] }, { label: 'x', bbox: [1] }] }],
  );
  assert.equal(regions.length, 1);
  assert.deepEqual(regions[0], { id: 'a#0', imageId: 'a', bbox: [1, 2, 3, 4] });
  assert.deepEqual(objectLabels[0], { regionId: 'a#0', label: 'car' });
});

test('tool_2/tool_3 vectors rank the matching guideline first', () => {
  const cv = tool2EmbedCaptions([{ imageId: 'a', text: 'A cyclist rides a bicycle next to cars on the road' }]);
  const gv = tool3EmbedGuidelines(DEMO_GUIDELINES);
  const [s] = similarities(cv, gv);
  assert.equal(s.scores[0].guidelineId, 'g3');
});

test('tool_4 extract and expand build labeled examples', () => {
  const st = {
    labeledExamples: [], finalLabels: [{ imageId: 'a', label: 'low_risk' }],
    humanReviews: [{ imageId: 'a', verdict: 'disagree', comment: 'on sidewalk' }],
    conceptLabels: [], captions: [{ imageId: 'a', text: 'cap' }], rationales: [],
    taskLabels: { current: [{ imageId: 'a', label: 'high_risk' }] },
    assistantReply: { imageId: 'a', question: 'q', text: 'ans', suggestedLabel: 'low_risk' },
    replyReview: { imageId: 'a', helpful: true, comment: '' },
  };
  const ex = tool4Extract(st, ['a']);
  assert.equal(ex[0].label, 'low_risk');
  assert.equal(ex[0].modelLabel, 'high_risk');
  st.labeledExamples = ex;
  const ex2 = tool4Expand(st, 'a');
  assert.equal(ex2[0].dialogue.length, 1);
});

test('output validation helpers', () => {
  assert.equal(oneOf('HIGH_RISK', ['high_risk']), 'high_risk');
  assert.throws(() => oneOf('cat', ['dog']));
  assert.equal(clamp01(80), 0.8);
  assert.throws(() => byImage([{ imageId: 'a' }], ['a', 'b'], (x) => x));
  assert.deepEqual(extractJson('```json\n[{"a":1}]\n```'), [{ a: 1 }]);
  assert.deepEqual(extractJson('Here: {"a":1} done'), { a: 1 });
});

test('demo dataset renders images with annotations', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sx-'));
  const { images, annotations } = await buildDemo(dir);
  assert.equal(images.length, 8);
  assert.ok(fs.existsSync(path.join(dir, images[0].file)));
  assert.ok(annotations.every((a) => a.objects.length > 0));
});
