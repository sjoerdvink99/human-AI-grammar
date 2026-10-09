// Offline tests: MOCK_LLM replaces the Claude CLI with a deterministic responder keyed on each actor's prompt.
process.env.MOCK_LLM = '1';
process.env.DATA_DIR = (await import('node:fs')).mkdtempSync((await import('node:os')).tmpdir() + '/sx-');
import test from 'node:test';
import assert from 'node:assert/strict';
const { setMockHandler, extractJson } = await import('../server/llm.js');
const store = await import('../server/store.js');
const { seed } = await import('../server/seed.js');
const p1 = await import('../server/process1.js');
const p2 = await import('../server/process2.js');
const p4 = await import('../server/process4.js');
const p5 = await import('../server/process5.js');
const p6 = await import('../server/process6.js');
const tool4 = await import('../server/logs.js');

const ids = (prompt, re) => [...new Set(prompt.match(re) || [])];
setMockHandler((system, prompt) => {
  if (system.includes('object detector')) return JSON.stringify({ regions: [{ label: 'crane', box: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 } }, { label: 'unicorn', box: { x: 0.6, y: 0.6, w: 0.9, h: 0.2 } }] });
  if (system.includes('art historian')) return JSON.stringify({ artwork_description: 'A test artwork with motifs.', units: ids(prompt, /art-\d+\.u\d+/g).map((id) => ({ id, description: `region ${id} shows a crane` })) });
  if (system.includes('Skill Recommendation')) return '```json\n' + JSON.stringify({ skills: ids(prompt, /\[(sk-[a-z-]+)\]/g).slice(0, 3).map((s) => ({ id: s.slice(1, -1), reason: 'fits' })) }) + '\n```';
  if (system.includes('Cluster and Pattern')) {
    const units = ids(prompt, /art-\d+\.u\d+/g);
    if (prompt.includes('For each cluster write')) return JSON.stringify({ patterns: ids(prompt.split('Regions:')[0], /\b[ck]\d+\b/g).map((c) => ({ cluster_id: c, pattern: 'They share a crane motif.' })) });
    return JSON.stringify({ clusters: [{ name: 'A', unit_ids: units.filter((_, i) => i % 2 === 0) }, { name: 'B', unit_ids: units.filter((_, i) => i % 2) }] });
  }
  if (system.includes('Label Recommendation')) {
    const cl = ids(prompt, /\b[ck]\d+\b/g);
    if (prompt.includes('score the 3')) return JSON.stringify({ scores: cl.map((c) => ({ cluster_id: c, labels: [{ label: 'Longevity', score: 0.9 }, { label: 'Purity', score: 0.3 }] })) });
    if (prompt.includes('Select 1–3')) return JSON.stringify({ recommendations: cl.map((c) => ({ cluster_id: c, labels: ['Longevity'] })) });
    if (prompt.includes('explanation')) return JSON.stringify({ rationales: cl.map((c) => ({ cluster_id: c, label: 'Longevity', rationale: 'Cranes conventionally signify long life.' })) });
    if (prompt.includes('urgently')) return JSON.stringify({ priorities: cl.map((c, i) => ({ cluster_id: c, score: i ? 0.2 : 0.8, reason: 'ambiguous' })) });
    return JSON.stringify({ priority_cluster_ids: [cl[0]] });
  }
  if (system.includes('Chatbot')) return JSON.stringify({ answer: 'Because cranes live long.', comparisons: [{ item: 'art-2', contrast: 'no crane' }], suggested_labels: ['Longevity', 'Not a label'] });
  if (system.includes('Behavior Mining')) return JSON.stringify({ behaviors: [{ behavior: 'checked crown colour', procedure: ['look at head'], evidence: '#1' }] });
  if (system.includes('Skill Generation')) return JSON.stringify({ skills: [{ name: 'Check crane crown', applies_to: 'bird motifs', procedure: ['inspect head'], cues: ['crane'] }] });
  if (prompt.includes('overlap with it')) return JSON.stringify({ matches: [{ candidate: 'cand-0', skill_ids: ['sk-motif-combo'] }] });
  if (prompt.includes('skipped as redundant') || system.includes('skipped as redundant')) return JSON.stringify({ differences: [{ candidate: 'cand-0', action: 'branch', target_id: 'sk-motif-combo', difference: 'narrower: birds' }] });
  if (system.includes('final text of skill')) return JSON.stringify({ updates: [{ candidate: 'cand-0', skill: { name: 'Crane pairings', applies_to: 'birds', procedure: ['x'], cues: [] } }] });
  if (system.includes('Summary Agent')) return JSON.stringify({ summary: 'Cranes with pines signal longevity in birthday gifts.' });
  if (system.includes('Memory Management')) return JSON.stringify({ add: [{ concept: 'pine', meaning: 'endurance', evidence: 'task' }], update: [{ index: 0, meaning: 'Longevity (confirmed)', evidence: 'task' }] });
  throw new Error('unmocked prompt: ' + system.slice(0, 80));
});

test('extractJson handles fences and prose', () => {
  assert.deepEqual(extractJson('Sure!\n```json\n{"a":[1,"}"]}\n```'), { a: [1, '}'] });
  assert.deepEqual(extractJson('x {"b":2} y'), { b: 2 });
});

test('processes 1 → 2 → 3 → 4 → 5 → 6 → 7 with mocked models', async () => {
  const s = await seed();
  s.artworks = s.artworks.slice(0, 3);
  for (const a of s.artworks) await p1.prepareArtwork(a);
  assert.ok(s.artworks.every((a) => a.status === 'ready'), s.artworks.map((a) => a.error).join());
  const u = s.artworks[0].units;
  assert.equal(u[1].basicLabel, 'other', 'basic labels restricted to detector vocabulary');
  assert.ok(u[1].box.x + u[1].box.w <= 1);

  // Process 2
  const task = { id: 't1', instruction: 'longevity', pipeline: 'recommend', steps: [], suggestedSkills: [], chosenSkills: [], clusters: [], confirmed: {}, feedback: {}, logs: [], chat: [] };
  s.tasks.push(task);
  task.suggestedSkills = await p2.suggestSkills(task);
  assert.equal(task.suggestedSkills.length, 3);
  task.chosenSkills = [task.suggestedSkills[0].skillId];
  await p2.runRecommendPipeline(task);
  assert.equal(task.status, 'review');
  assert.equal(task.clustersInitial.length, 2);
  assert.ok(task.clusters.every((c) => c.pattern && c.recommendedLabels[0] === 'Longevity' && c.rationales.Longevity && c.priority));
  assert.deepEqual(task.priorityClusterIds, [task.clusters[0].id]);
  assert.ok(task.steps.some((st) => st.name.startsWith('tool_3')));

  // Process 3
  const cid = task.priorityClusterIds[0];
  task.confirmed[`cluster:${cid}`] = { labels: ['Longevity'], source: 'review' };
  tool4.extract(task, { clusterId: cid, feedback: [{ label: 'Longevity', verdict: 'accept', comment: '' }], labels: ['Longevity'] });
  assert.equal(task.logs.length, 1);

  // Process 4
  const ans = await p4.chatAnswer(task, { type: 'artwork', id: 'art-1' }, 'why?');
  assert.deepEqual(ans.suggested_labels, ['Longevity'], 'non-taxonomy labels filtered');
  tool4.expand(task, { focus: { type: 'artwork', id: 'art-1' }, question: 'why?', answer: ans, decision: { verdict: 'agree', note: '', labels: ['Longevity'] }, labelsBefore: [], labelsAfter: ['Longevity'] });
  assert.match(tool4.formatLogs(task.logs), /CHAT about artwork art-1/);

  // Process 5
  const lib = s.skillLibrary.skills;
  const mined = await p5.mineBehaviors(task.logs, lib);
  const cands = await p5.generateSkills(mined, lib);
  const matches = await p5.matchSkills(cands, lib);
  const diffs = await p5.diffSkills(cands, matches, lib);
  const upd = await p5.updateLibrary(cands, diffs, lib, 't1');
  assert.equal(upd.skills.length, lib.length + 1);
  assert.equal(upd.skills.at(-1).parent, 'sk-motif-combo');

  // Process 6
  const summary = await p6.summarizeTask(task, s.knowledgeBase);
  const kb = await p6.integrateKnowledge(summary, s.knowledgeBase, 't1');
  assert.equal(kb.entries.length, s.knowledgeBase.entries.length + 1);
  assert.match(kb.entries[0].meaning, /confirmed/);

  // Process 7
  s.skillLibrary.skills = upd.skills; s.skillLibrary.version = 2;
  const t2 = { id: 't2', instruction: 'marriage', pipeline: 'reuse', steps: [], suggestedSkills: [], chosenSkills: ['sk-season'], clusters: [], confirmed: {}, feedback: {}, logs: [], chat: [] };
  s.tasks.push(t2);
  await p2.runReusePipeline(t2);
  assert.equal(t2.status, 'review');
  assert.ok(!t2.steps.some((st) => st.name.startsWith('tool_2') || st.name.includes('priorit') || st.name.includes('refine')));
  assert.ok(t2.clusters.every((c) => c.rationales.Longevity));
});

test('cluster partition validation rejects duplicate units', async () => {
  const s = store.getState();
  setMockHandler(() => JSON.stringify({ clusters: [{ name: 'x', unit_ids: ['art-1.u1'] }, { name: 'y', unit_ids: ['art-1.u1'] }] }));
  await assert.rejects(p2.assignClusters({ chosenSkills: [] }, null), /more than one cluster/);
  assert.ok(s);
});
