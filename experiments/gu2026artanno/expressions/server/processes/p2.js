// Process 2 (first task, exploratory) and process 7 (later task with skill_library_2 + knowledge_base_2).
// Both share these model roles:
//   model_2 select  — suggest skills for the task
//   model_3 assign / modify / generate~ — cluster units, refine clusters, describe cluster patterns
//   model_4 evaluate / select / generate~ / evaluate / select — score labels, recommend, explain, prioritise
import { callModel } from '../llm.js';
import { load, save, latestSkills, latestKB, getRun, newId } from '../store.js';
import { taxonomyOutline } from '../seed/taxonomy.js';
import { tool2TextEmbed, tool3ImageEmbed, kmeans, concatEmbeddings } from '../tools/embeddings.js';
import { contactSheet, imagePathFor } from '../tools/images.js';
import { runStep } from '../jobs.js';

export const P2_STEPS = ['tool_2 translate', 'tool_3 translate', 'model_3 assign', 'model_3 modify',
  'model_3 generate~', 'model_4 evaluate (labels)', 'model_4 select (labels)', 'model_4 generate~',
  'model_4 evaluate (priority)', 'model_4 select (priority)'];
export const P7_STEPS = ['model_3 assign', 'model_3 generate~', 'model_4 evaluate (labels)', 'model_4 select (labels)', 'model_4 generate~'];

// ---------- prompt building blocks (each built from one representation) ----------
const fmtSkills = (skills) => skills.map((s) => `- [${s.id}] ${s.name}: ${s.description}\n  When: ${s.whenToUse}\n  Procedure: ${s.procedure}`).join('\n');
const fmtChosen = (chosen, skills) => chosen.map((c) => {
  const s = skills.find((k) => k.id === c.skillId);
  return s ? `- ${s.name}: ${s.procedure}\n  Application to this task: ${c.application}` : '';
}).join('\n');
const fmtKB = (kb) => kb.entries.map((e) => `- (${e.id}) ${e.topic}: ${e.content}`).join('\n') || '(empty)';
const fmtUnits = (unitDescriptions) => unitDescriptions.map((d) => `- ${d.unitId}: ${d.text}`).join('\n');
const fmtClusters = (clusters) => clusters.map((c) => `- ${c.id} "${c.name}": ${c.unitIds.join(', ')}`).join('\n');
const fmtClusterHeads = (clusters, patterns) => clusters.map((c) => `- ${c.id} "${c.name}" (${c.unitIds.length} units): ${patterns.find((p) => p.clusterId === c.id)?.text || ''}`).join('\n');

const CLUSTERS_SCHEMA = {
  type: 'object',
  properties: {
    clusters: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, unitIds: { type: 'array', items: { type: 'string' } } }, required: ['name', 'unitIds'] } },
    changes: { type: 'array', items: { type: 'string' } },
  },
  required: ['clusters'],
};

/** Check / repair a model clustering so every unit is in exactly one cluster. */
export function normalizeClusters(raw, allUnitIds) {
  const valid = new Set(allUnitIds);
  const seen = new Set();
  const clusters = [];
  for (const c of raw) {
    const ids = c.unitIds.filter((id) => valid.has(id) && !seen.has(id));
    ids.forEach((id) => seen.add(id));
    if (ids.length) clusters.push({ id: `c${clusters.length + 1}`, name: c.name.trim() || `Cluster ${clusters.length + 1}`, unitIds: ids });
  }
  const missing = allUnitIds.filter((id) => !seen.has(id));
  if (missing.length) clusters.push({ id: `c${clusters.length + 1}`, name: 'Unassigned', unitIds: missing });
  return { clusters, missing };
}
const clusterValidator = (allUnitIds) => (o) => {
  const got = new Set(o.clusters.flatMap((c) => c.unitIds));
  const missing = allUnitIds.filter((id) => !got.has(id));
  return missing.length > Math.max(2, allUnitIds.length * 0.1) ? `${missing.length} unit ids were not assigned (e.g. ${missing.slice(0, 5).join(', ')}); every unit must be in exactly one cluster` : null;
};

// ---------- model_2 select ----------
export async function model2SelectSkills({ task, artworkDescriptions, unitDescriptions, skills, kb, taxonomy }) {
  const ids = new Set(skills.map((s) => s.id));
  const out = await callModel({
    role: 'model_2',
    system: 'You are model_2, a planner for an artwork-annotation assistant. Given an annotation task and a library of skills, choose the skills that will help most and explain how each applies to this task.',
    prompt: `Task: ${task}

Collection: ${artworkDescriptions.length} artworks, ${unitDescriptions.length} annotated units. Sample artwork descriptions:
${artworkDescriptions.slice(0, 6).map((d) => `- ${d.text}`).join('\n')}

Label taxonomy:
${taxonomyOutline(taxonomy)}

Knowledge base:
${fmtKB(kb)}

Skill library:
${fmtSkills(skills)}

Rank the skills that are relevant (2-5 of them). For each give skillId, relevance 0-1, reason (why it fits), and application: one or two concrete sentences telling a clustering model how to apply this skill for this task.`,
    schema: { type: 'object', properties: { suggestions: { type: 'array', items: { type: 'object', properties: { skillId: { type: 'string' }, relevance: { type: 'number' }, reason: { type: 'string' }, application: { type: 'string' } }, required: ['skillId', 'relevance', 'reason', 'application'] } } }, required: ['suggestions'] },
    validate: (o) => (o.suggestions.some((s) => !ids.has(s.skillId)) ? `unknown skill id; use only ${[...ids].join(', ')}` : null),
  });
  return out.suggestions.filter((s) => ids.has(s.skillId)).map((s) => ({ ...s, relevance: Math.max(0, Math.min(1, s.relevance)) }));
}

// ---------- model_3 ----------
const SYSTEM_3 = `You are model_3, a clustering analyst for artwork units. You group units (regions inside
artworks) so that each cluster can be reviewed and labelled with a single taxonomy label. Apply the chosen
skills and the knowledge base. Use unit ids exactly as given.`;

export async function model3Assign({ unitDescriptions, hints, chosen, skills, kb, taxonomy }) {
  const all = unitDescriptions.map((d) => d.unitId);
  const out = await callModel({
    role: 'model_3', system: SYSTEM_3, schema: CLUSTERS_SCHEMA, validate: clusterValidator(all),
    prompt: `Chosen skills:
${fmtChosen(chosen, skills)}

Knowledge base:
${fmtKB(kb)}

Label taxonomy:
${taxonomyOutline(taxonomy)}

Units:
${fmtUnits(unitDescriptions)}
${hints ? `\nSimilarity hints from text+image embeddings (k-means groups; use as evidence, not as the answer):\n${hints.map((g, i) => `- group ${i + 1}: ${g.join(', ')}`).join('\n')}\n` : ''}
Assign every unit to exactly one cluster. Give each cluster a short descriptive name.`,
  });
  return normalizeClusters(out.clusters, all);
}

export async function model3Refine({ clusters, unitDescriptions, chosen, skills, kb, taxonomy }) {
  const all = unitDescriptions.map((d) => d.unitId);
  const out = await callModel({
    role: 'model_3', system: SYSTEM_3, schema: CLUSTERS_SCHEMA, validate: clusterValidator(all),
    prompt: `Chosen skills:
${fmtChosen(chosen, skills)}

Knowledge base:
${fmtKB(kb)}

Label taxonomy:
${taxonomyOutline(taxonomy)}

Units:
${fmtUnits(unitDescriptions)}

Current clusters:
${fmtClusters(clusters)}

Refine these clusters: split clusters that would need more than one taxonomy label, merge clusters that would get the same label, move misplaced units. Return the full refined clustering (every unit exactly once) and a list of the changes you made in plain words.`,
  });
  return { ...normalizeClusters(out.clusters, all), changes: out.changes || [] };
}

export async function model3Patterns({ clusters, unitDescriptions, chosen, skills, kb, taxonomy }) {
  const ids = clusters.map((c) => c.id);
  const out = await callModel({
    role: 'model_3', system: SYSTEM_3,
    schema: { type: 'object', properties: { patterns: { type: 'array', items: { type: 'object', properties: { clusterId: { type: 'string' }, pattern: { type: 'string' } }, required: ['clusterId', 'pattern'] } } }, required: ['patterns'] },
    validate: (o) => { const got = new Set(o.patterns.map((p) => p.clusterId)); const miss = ids.filter((i) => !got.has(i)); return miss.length ? `missing patterns for ${miss.join(', ')}` : null; },
    prompt: `Chosen skills:
${fmtChosen(chosen, skills)}

Knowledge base:
${fmtKB(kb)}

Label taxonomy:
${taxonomyOutline(taxonomy)}

Units:
${fmtUnits(unitDescriptions)}

Clusters:
${fmtClusters(clusters)}

For each cluster id, write the shared visual/iconographic pattern of its units in 1-3 sentences, mentioning notable exceptions (by unit id) if any.`,
  });
  return ids.map((id) => ({ clusterId: id, text: out.patterns.find((p) => p.clusterId === id)?.pattern || '' }));
}

// ---------- model_4 ----------
const SYSTEM_4 = `You are model_4, an iconographic labelling expert. You judge clusters of artwork units
against a label taxonomy, using the cluster patterns, a contact sheet of unit crops (one row per cluster)
and the knowledge base.`;

export async function model4ScoreLabels({ clusters, patterns, sheet, kb, taxonomy }) {
  const labelIds = new Set(taxonomy.nodes.map((n) => n.id).filter((id) => id !== 'root'));
  const ids = clusters.map((c) => c.id);
  const out = await callModel({
    role: 'model_4', system: SYSTEM_4, images: [sheet],
    schema: { type: 'object', properties: { scores: { type: 'array', items: { type: 'object', properties: { clusterId: { type: 'string' }, labels: { type: 'array', items: { type: 'object', properties: { labelId: { type: 'string' }, score: { type: 'number' } }, required: ['labelId', 'score'] } } }, required: ['clusterId', 'labels'] } } }, required: ['scores'] },
    validate: (o) => {
      const bad = o.scores.flatMap((s) => s.labels).filter((l) => !labelIds.has(l.labelId));
      const got = new Set(o.scores.map((s) => s.clusterId));
      if (bad.length) return `unknown label ids ${bad.map((b) => b.labelId).join(', ')}`;
      const miss = ids.filter((i) => !got.has(i));
      return miss.length ? `missing clusters ${miss.join(', ')}` : null;
    },
    prompt: `Label taxonomy (use these ids):
${taxonomyOutline(taxonomy)}

Knowledge base:
${fmtKB(kb)}

Clusters (rows of the contact sheet, top to bottom):
${fmtClusterHeads(clusters, patterns)}

For every cluster, score the 3-5 most plausible taxonomy labels from 0 (does not fit) to 1 (fits every unit). Prefer leaf labels.`,
  });
  return ids.map((id) => ({
    clusterId: id,
    scores: (out.scores.find((s) => s.clusterId === id)?.labels || []).filter((l) => labelIds.has(l.labelId))
      .map((l) => ({ labelId: l.labelId, score: Math.max(0, Math.min(1, l.score)) })).sort((a, b) => b.score - a.score),
  }));
}

export async function model4RecommendLabels({ clusters, patterns, labelScores, kb }) {
  const out = await callModel({
    role: 'model_4', system: SYSTEM_4,
    schema: { type: 'object', properties: { recommendations: { type: 'array', items: { type: 'object', properties: { clusterId: { type: 'string' }, labelId: { type: 'string' } }, required: ['clusterId', 'labelId'] } } }, required: ['recommendations'] },
    validate: (o) => {
      for (const r of o.recommendations) {
        const cand = labelScores.find((s) => s.clusterId === r.clusterId);
        if (cand && !cand.scores.some((s) => s.labelId === r.labelId)) return `${r.labelId} was not a scored candidate for ${r.clusterId}`;
      }
      return null;
    },
    prompt: `Knowledge base:
${fmtKB(kb)}

Clusters:
${fmtClusterHeads(clusters, patterns)}

Candidate label scores:
${labelScores.map((s) => `- ${s.clusterId}: ${s.scores.map((l) => `${l.labelId}=${l.score.toFixed(2)}`).join(', ')}`).join('\n')}

Select exactly one recommended label per cluster from its scored candidates. Apply knowledge-base rules (they may override the highest score).`,
  });
  // enforce: one label per cluster, from its candidates; fall back to the top score.
  return labelScores.map((s) => {
    const r = out.recommendations.find((x) => x.clusterId === s.clusterId);
    const ok = r && s.scores.some((l) => l.labelId === r.labelId);
    return { clusterId: s.clusterId, labelId: ok ? r.labelId : s.scores[0]?.labelId ?? 'root' };
  });
}

export async function model4Rationales({ clusters, patterns, recommended, kb, taxonomy }) {
  const name = (id) => taxonomy.nodes.find((n) => n.id === id)?.label || id;
  const out = await callModel({
    role: 'model_4', system: SYSTEM_4,
    schema: { type: 'object', properties: { rationales: { type: 'array', items: { type: 'object', properties: { clusterId: { type: 'string' }, rationale: { type: 'string' } }, required: ['clusterId', 'rationale'] } } }, required: ['rationales'] },
    prompt: `Knowledge base:
${fmtKB(kb)}

Clusters with recommended labels:
${clusters.map((c) => `- ${c.id} "${c.name}" (${c.unitIds.length} units) → ${recommended.find((r) => r.clusterId === c.id)?.labelId} (${name(recommended.find((r) => r.clusterId === c.id)?.labelId)}). Pattern: ${patterns.find((p) => p.clusterId === c.id)?.text}`).join('\n')}

For each cluster write a 2-3 sentence rationale a curator can check: the visual evidence for the label, any knowledge-base rule applied, and what would make the label wrong.`,
  });
  return clusters.map((c) => ({ clusterId: c.id, text: out.rationales.find((r) => r.clusterId === c.id)?.rationale || '' }));
}

export async function model4Prioritize({ clusters, patterns, recommended, rationales }) {
  const out = await callModel({
    role: 'model_4', system: SYSTEM_4,
    schema: { type: 'object', properties: { priorities: { type: 'array', items: { type: 'object', properties: { clusterId: { type: 'string' }, priority: { type: 'number' }, reason: { type: 'string' } }, required: ['clusterId', 'priority', 'reason'] } } }, required: ['priorities'] },
    prompt: `Clusters:
${clusters.map((c) => `- ${c.id} "${c.name}" (${c.unitIds.length} units) → recommended ${recommended.find((r) => r.clusterId === c.id)?.labelId}. Pattern: ${patterns.find((p) => p.clusterId === c.id)?.text} Rationale: ${rationales.find((r) => r.clusterId === c.id)?.text}`).join('\n')}

Rate how urgently a human should review each cluster, 0 (safe to accept) to 1 (review first). Weigh uncertainty or mixed content, number of units affected, and risk of a wrong iconographic reading. Give a one-sentence reason.`,
  });
  return clusters.map((c) => {
    const p = out.priorities.find((x) => x.clusterId === c.id);
    return { clusterId: c.id, priority: Math.max(0, Math.min(1, p?.priority ?? 0.5)), reason: p?.reason || '' };
  });
}

export async function model4SelectPriority({ clusters, priorities, recommended, rationales }) {
  const ids = new Set(clusters.map((c) => c.id));
  const out = await callModel({
    role: 'model_4', system: SYSTEM_4,
    schema: { type: 'object', properties: { queue: { type: 'array', items: { type: 'string' } } }, required: ['queue'] },
    validate: (o) => (o.queue.some((id) => !ids.has(id)) ? 'queue contains unknown cluster ids' : o.queue.length === 0 ? 'queue is empty' : null),
    prompt: `Clusters with review priority:
${priorities.map((p) => `- ${p.clusterId} "${clusters.find((c) => c.id === p.clusterId)?.name}": priority ${p.priority.toFixed(2)} — ${p.reason}; recommended ${recommended.find((r) => r.clusterId === p.clusterId)?.labelId}; rationale: ${rationales.find((r) => r.clusterId === p.clusterId)?.text}`).join('\n')}

Select the clusters the curator should review, in review order (most important first). Include every cluster whose label is uncertain or consequential; at least 3 clusters if there are that many.`,
  });
  return [...new Set(out.queue.filter((id) => ids.has(id)))];
}

// ---------- orchestration ----------
export function unitsInScope(s) {
  const described = new Set(s.unitDescriptions.map((d) => d.unitId));
  return s.boundingBoxes.filter((b) => described.has(b.unitId));
}

/** Process 2/7 first step: model_2 select. Creates a run waiting for human select. */
export async function suggestSkills({ task, mode }) {
  const s = load();
  if (!s.unitDescriptions.length) throw new Error('Describe the collection first (process 1).');
  const lib = latestSkills(s), kb = latestKB(s);
  const suggestions = await model2SelectSkills({ task, artworkDescriptions: s.artworkDescriptions, unitDescriptions: s.unitDescriptions, skills: lib.skills, kb, taxonomy: s.labelTaxonomy });
  const run = {
    id: newId('run'), process: mode === 'p7' ? 7 : 2, task, createdAt: new Date().toISOString(),
    skillLibraryVersion: lib.version, knowledgeBaseVersion: kb.version,
    suggestedSkills: suggestions, chosenSkills: [], status: 'awaiting_skills',
  };
  s.runs.push(run);
  save();
  return run;
}

export async function runClustering(job, runId) {
  const s = load();
  const run = getRun(runId, s);
  const lib = s.skillLibrary.versions.find((v) => v.version === run.skillLibraryVersion);
  const kb = s.knowledgeBase.versions.find((v) => v.version === run.knowledgeBaseVersion);
  const skills = lib.skills, taxonomy = s.labelTaxonomy;
  const chosen = run.chosenSkills.map((id) => ({ skillId: id, application: run.suggestedSkills.find((x) => x.skillId === id)?.application || '' }));
  const units = unitsInScope(s);
  const unitDescriptions = units.map((u) => s.unitDescriptions.find((d) => d.unitId === u.unitId));
  run.status = 'running';
  save();
  const persist = (patch) => { Object.assign(run, patch); save(); };

  let hints = null;
  if (run.process === 2) {
    const text = await runStep(job, 'tool_2 translate', async () => {
      const t = tool2TextEmbed(units, s.unitDescriptions, s.artworkDescriptions);
      return Object.assign(t, { __detail: `${t.length} × ${t[0]?.vector.length}` });
    });
    const image = await runStep(job, 'tool_3 translate', async () => {
      const im = await tool3ImageEmbed(units, imagePathFor(s.artworks));
      return Object.assign(im, { __detail: `${im.length} × ${im[0]?.vector.length}` });
    });
    const joined = concatEmbeddings(text, image);
    const k = Math.max(3, Math.round(Math.sqrt(units.length / 2)));
    const assign = kmeans(joined.map((j) => j.vector), k);
    hints = Array.from({ length: k }, (_, j) => joined.filter((_, i) => assign[i] === j).map((x) => x.unitId)).filter((g) => g.length);
    persist({ embeddings: { textDim: text[0]?.vector.length, imageDim: image[0]?.vector.length, n: units.length, k, hintGroups: hints } });
  }

  let clusters = await runStep(job, 'model_3 assign', async () => {
    const r = await model3Assign({ unitDescriptions, hints, chosen, skills, kb, taxonomy });
    persist({ clustersAssigned: r.clusters });
    return Object.assign(r.clusters, { __detail: `${r.clusters.length} clusters${r.missing.length ? `, ${r.missing.length} unassigned` : ''}` });
  });
  if (run.process === 2) {
    clusters = await runStep(job, 'model_3 modify', async () => {
      const r = await model3Refine({ clusters, unitDescriptions, chosen, skills, kb, taxonomy });
      persist({ refineChanges: r.changes });
      return Object.assign(r.clusters, { __detail: `${r.clusters.length} clusters, ${r.changes.length} changes` });
    });
  }
  persist({ clusters: [...clusters], clustersVersion: run.process === 2 ? 2 : 3 });

  const patterns = await runStep(job, 'model_3 generate~', () => model3Patterns({ clusters, unitDescriptions, chosen, skills, kb, taxonomy }));
  persist({ clusterPatterns: patterns });

  const sheet = await contactSheet(clusters.map((c) => ({ caption: `${c.id} ${c.name}`, units: c.unitIds.map((id) => s.boundingBoxes.find((b) => b.unitId === id)) })), s.artworks, `sheet-${run.id}`);
  const labelScores = await runStep(job, 'model_4 evaluate (labels)', () => model4ScoreLabels({ clusters, patterns, sheet, kb, taxonomy }));
  persist({ labelScores });
  const recommended = await runStep(job, 'model_4 select (labels)', () => model4RecommendLabels({ clusters, patterns, labelScores, kb }));
  persist({ recommendedLabels: recommended });
  const rationales = await runStep(job, 'model_4 generate~', () => model4Rationales({ clusters, patterns, recommended, kb, taxonomy }));
  persist({ recommendationRationales: rationales });

  if (run.process === 2) {
    const priorities = await runStep(job, 'model_4 evaluate (priority)', () => model4Prioritize({ clusters, patterns, recommended, rationales }));
    persist({ clusterPriorities: priorities });
    const queue = await runStep(job, 'model_4 select (priority)', () => model4SelectPriority({ clusters, priorities, recommended, rationales }));
    persist({ priorityClusters: queue });
  }
  persist({ status: 'done' });
  s.activeRunId = run.id;
  save();
  return { runId: run.id };
}
