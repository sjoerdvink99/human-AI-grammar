// Process 2 — Proactively recommend clusters and labels (and Process 7 — reuse in a later task).
// Every model step builds its prompt only from the representations present in the preceding state.
import { z } from 'zod';
import { callModelJson } from './llm.js';
import { getState, save, allUnits, taxonomyLeaves, taxonomyOutline, findArtwork, imagePath } from './store.js';
import { textEmbeddings, imageEmbedding, neighbourSummary } from './embeddings.js';

// ---------- context renderers (representation → prompt text) ----------
const fmtSkills = (skills) => skills.map((s) => `[${s.id}] ${s.name} (v${s.version}) — applies to: ${s.applies_to}\n  procedure: ${s.procedure.join(' → ')}\n  cues: ${(s.cues || []).join(', ')}`).join('\n');
const fmtKB = (kb) => kb.entries.length ? kb.entries.map((e) => `- ${e.concept}: ${e.meaning}${e.evidence ? ` (evidence: ${e.evidence})` : ''}`).join('\n') : '(empty)';
const fmtUnits = (units) => units.map((u) => `${u.id} [${u.basicLabel}] in "${findArtwork(u.artworkId)?.metadata?.title}": ${u.description}`).join('\n');
const fmtArtworks = (arts) => arts.map((a) => `${a.id} "${a.metadata?.title}" (${a.metadata?.period}, ${a.metadata?.origin}): ${a.description}`).join('\n');
const fmtClusters = (clusters, unitsById, withPattern = false) => clusters.map((c) =>
  `${c.id} "${c.name}": ${c.unitIds.map((id) => `${id}[${unitsById[id]?.basicLabel}]`).join(', ')}${withPattern && c.pattern ? `\n  pattern: ${c.pattern}` : ''}`).join('\n');
const chosen = (task) => getState().skillLibrary.skills.filter((s) => task.chosenSkills.includes(s.id));

// ---------- model_2 select: suggested_skills ----------
const SuggestSchema = z.object({ skills: z.array(z.object({ id: z.string(), reason: z.string() })) });
export async function suggestSkills(task) {
  const s = getState();
  const lib = s.skillLibrary.skills;
  const n = Math.min(3, lib.length);
  const arts = s.artworks.filter((a) => a.status === 'ready');
  const out = await callModelJson({
    system: 'You are the Skill Recommendation Agent of an artwork annotation system. You choose which reusable annotation skills best fit the annotator\'s task.',
    prompt: `Annotation task: ${task.instruction}

Artworks:
${fmtArtworks(arts)}

Region descriptions:
${fmtUnits(allUnits())}

Skill library:
${fmtSkills(lib)}

Knowledge base:
${fmtKB(s.knowledgeBase)}

Label taxonomy:
${taxonomyOutline()}
Choose exactly the ${n} most relevant skills for this task and say in one sentence why each helps.
JSON: {"skills":[{"id":"<skill id>","reason":"..."}]}`,
    schema: SuggestSchema,
    check: (v) => {
      const ids = new Set(v.skills.map((x) => x.id));
      if (v.skills.length !== n || ids.size !== n) return `return exactly ${n} distinct skills`;
      const bad = [...ids].filter((id) => !lib.find((k) => k.id === id));
      return bad.length ? `unknown skill ids ${bad.join(', ')}` : null;
    },
  });
  return out.skills.map((x) => ({ skillId: x.id, reason: x.reason }));
}

// ---------- tool_2 / tool_3 translate ----------
/** tool_2 translate: unit descriptions (with their artwork description) → text_embeddings. */
export function computeTextEmbeddings() {
  const units = allUnits();
  return textEmbeddings(units.map((u) => ({ id: u.id, text: `${u.basicLabel} ${u.description} ${findArtwork(u.artworkId).description}` })));
}
/** tool_3 translate: artwork image regions → image_embeddings. */
export async function computeImageEmbeddings() {
  const image = {};
  for (const u of allUnits()) image[u.id] = await imageEmbedding(imagePath(findArtwork(u.artworkId)), u.box);
  return image;
}

// ---------- model_3 assign / modify / generate ----------
const ClusterSchema = z.object({ clusters: z.array(z.object({ name: z.string(), unit_ids: z.array(z.string()).min(1) })).min(1) });
const checkPartition = (units) => (v) => {
  const ids = new Set(units.map((u) => u.id));
  const seen = new Set();
  for (const c of v.clusters) for (const id of c.unit_ids) {
    if (!ids.has(id)) return `unknown unit id ${id}`;
    if (seen.has(id)) return `unit ${id} appears in more than one cluster`;
    seen.add(id);
  }
  return null;
};
const toClusters = (v, prefix) => v.clusters.map((c, i) => ({ id: `${prefix}${i + 1}`, name: c.name, unitIds: c.unit_ids }));

const CLUSTER_SYS = 'You are the Cluster and Pattern Mining Agent of an artwork annotation system. You group image regions across artworks so that each group can share an implicit cultural meaning, guided by the annotator\'s chosen skills and accumulated knowledge.';

export async function assignClusters(task, emb /* null in process 7 */) {
  const s = getState();
  const units = allUnits();
  const v = await callModelJson({
    system: CLUSTER_SYS,
    prompt: `Regions:
${fmtUnits(units)}
${emb ? `\nNearest neighbours from text and image similarity embeddings (cosine):\n${neighbourSummary(emb.unitIds, emb.text, emb.image)}\n` : ''}
Chosen skills:
${fmtSkills(chosen(task))}

Knowledge base:
${fmtKB(s.knowledgeBase)}

Label taxonomy:
${taxonomyOutline()}
Assign regions to 3–10 clusters. A cluster groups regions (possibly from different artworks) whose meaning should be labelled together. Regions with no plausible implicit meaning (frames, plain background) may be left out. Each region at most once.
JSON: {"clusters":[{"name":"short name","unit_ids":["art-1.u1"]}]}`,
    schema: ClusterSchema,
    check: checkPartition(units),
  });
  return toClusters(v, 'c');
}

export async function refineClusters(task, clusters1) {
  const s = getState();
  const units = allUnits();
  const byId = Object.fromEntries(units.map((u) => [u.id, u]));
  const v = await callModelJson({
    system: CLUSTER_SYS,
    prompt: `Current clusters:
${fmtClusters(clusters1, byId)}

Regions:
${fmtUnits(units)}

Chosen skills:
${fmtSkills(chosen(task))}

Knowledge base:
${fmtKB(s.knowledgeBase)}

Label taxonomy:
${taxonomyOutline()}
Refine the clusters: merge clusters that would receive the same meaning, split clusters that mix meanings, and move misplaced regions. Apply the chosen skills (e.g. motif combinations across one artwork may belong together). Each region at most once.
JSON: {"clusters":[{"name":"short name","unit_ids":["..."]}]}`,
    schema: ClusterSchema,
    check: checkPartition(units),
  });
  return toClusters(v, 'k');
}

const PatternSchema = z.object({ patterns: z.array(z.object({ cluster_id: z.string(), pattern: z.string().min(10) })) });
const checkAllClusters = (clusters, key = 'cluster_id', field) => (v) => {
  const missing = clusters.filter((c) => !v[field].find((x) => x[key] === c.id)).map((c) => c.id);
  return missing.length ? `missing entries for clusters ${missing.join(', ')}` : null;
};

export async function describePatterns(task, clusters) {
  const s = getState();
  const units = allUnits();
  const byId = Object.fromEntries(units.map((u) => [u.id, u]));
  const v = await callModelJson({
    system: CLUSTER_SYS,
    prompt: `Clusters:
${fmtClusters(clusters, byId)}

Regions:
${fmtUnits(units)}

Chosen skills:
${fmtSkills(chosen(task))}

Knowledge base:
${fmtKB(s.knowledgeBase)}

Label taxonomy:
${taxonomyOutline()}
For each cluster write 1–3 sentences on what its regions share: visual motif, context, and the cultural pattern they suggest.
JSON: {"patterns":[{"cluster_id":"${clusters[0].id}","pattern":"..."}]}`,
    schema: PatternSchema,
    check: checkAllClusters(clusters, 'cluster_id', 'patterns'),
  });
  return Object.fromEntries(v.patterns.map((p) => [p.cluster_id, p.pattern]));
}

// ---------- model_4 evaluate / select / generate / evaluate / select ----------
const LABEL_SYS = 'You are the Label Recommendation Agent of an artwork annotation system. You judge which labels from the taxonomy express the implicit cultural meaning of each cluster.';

const ScoreSchema = z.object({ scores: z.array(z.object({ cluster_id: z.string(), labels: z.array(z.object({ label: z.string(), score: z.number().min(0).max(1) })).min(1) })) });
export async function scoreLabels(clusters, withTaxonomy = true) {
  const s = getState();
  const units = allUnits(); const byId = Object.fromEntries(units.map((u) => [u.id, u]));
  const leaves = taxonomyLeaves();
  const v = await callModelJson({
    system: LABEL_SYS,
    prompt: `Clusters with patterns:
${fmtClusters(clusters, byId, true)}

Knowledge base:
${fmtKB(s.knowledgeBase)}
${withTaxonomy ? `\nLabel taxonomy:\n${taxonomyOutline()}` : ''}
Allowed labels (leaves): ${leaves.join(' | ')}
For each cluster, score the 3–6 most plausible allowed labels from 0 (does not fit) to 1 (clearly fits).
JSON: {"scores":[{"cluster_id":"${clusters[0].id}","labels":[{"label":"${leaves[0]}","score":0.8}]}]}`,
    schema: ScoreSchema,
    check: (x) => {
      const bad = x.scores.flatMap((c) => c.labels.map((l) => l.label)).filter((l) => !leaves.includes(l));
      return bad.length ? `labels not in taxonomy: ${[...new Set(bad)].join(', ')}` : checkAllClusters(clusters, 'cluster_id', 'scores')(x);
    },
  });
  return Object.fromEntries(v.scores.map((c) => [c.cluster_id, c.labels.sort((a, b) => b.score - a.score)]));
}

const SelectSchema = z.object({ recommendations: z.array(z.object({ cluster_id: z.string(), labels: z.array(z.string()).min(1).max(3) })) });
export async function selectLabels(clusters) {
  const s = getState();
  const v = await callModelJson({
    system: LABEL_SYS,
    prompt: `Clusters, patterns and label scores:
${clusters.map((c) => `${c.id} "${c.name}" — ${c.pattern}\n  scores: ${c.labelScores.map((l) => `${l.label}=${l.score.toFixed(2)}`).join(', ')}`).join('\n')}

Knowledge base:
${fmtKB(s.knowledgeBase)}
Select 1–3 labels to recommend for each cluster, only from that cluster's scored labels. Prefer high scores, but drop a label if it is redundant with a higher one.
JSON: {"recommendations":[{"cluster_id":"${clusters[0].id}","labels":["..."]}]}`,
    schema: SelectSchema,
    check: (x) => {
      for (const r of x.recommendations) {
        const c = clusters.find((k) => k.id === r.cluster_id);
        if (!c) return `unknown cluster ${r.cluster_id}`;
        const bad = r.labels.filter((l) => !c.labelScores.find((sc) => sc.label === l));
        if (bad.length) return `cluster ${c.id}: labels ${bad.join(', ')} were not scored for it`;
      }
      return checkAllClusters(clusters, 'cluster_id', 'recommendations')(x);
    },
  });
  return Object.fromEntries(v.recommendations.map((r) => [r.cluster_id, r.labels]));
}

const RationaleSchema = z.object({ rationales: z.array(z.object({ cluster_id: z.string(), label: z.string(), rationale: z.string().min(10) })) });
export async function writeRationales(clusters, useKB = true) {
  const s = getState();
  const units = allUnits(); const byId = Object.fromEntries(units.map((u) => [u.id, u]));
  const pairs = clusters.flatMap((c) => c.recommendedLabels.map((l) => `${c.id} → ${l}`));
  const v = await callModelJson({
    system: LABEL_SYS,
    prompt: `Clusters with patterns:
${fmtClusters(clusters, byId, true)}

Regions in these clusters:
${fmtUnits(units.filter((u) => clusters.some((c) => c.unitIds.includes(u.id))))}
${useKB ? `\nKnowledge base:\n${fmtKB(s.knowledgeBase)}\n` : ''}
Recommended labels:
${pairs.join('\n')}
For each recommended label write a 1–3 sentence explanation for the annotator: the visual evidence in the regions and the cultural convention that links it to the label. Mention uncertainty where it exists.
JSON: {"rationales":[{"cluster_id":"...","label":"...","rationale":"..."}]}`,
    schema: RationaleSchema,
    check: (x) => {
      const missing = pairs.filter((p) => { const [c, l] = p.split(' → '); return !x.rationales.find((r) => r.cluster_id === c && r.label === l); });
      return missing.length ? `missing rationales for ${missing.join('; ')}` : null;
    },
  });
  const out = {};
  for (const r of v.rationales) (out[r.cluster_id] ||= {})[r.label] = r.rationale;
  return out;
}

const PrioritySchema = z.object({ priorities: z.array(z.object({ cluster_id: z.string(), score: z.number().min(0).max(1), reason: z.string() })) });
export async function scorePriorities(clusters) {
  const v = await callModelJson({
    system: LABEL_SYS,
    prompt: `Clusters with their recommendations:
${clusters.map((c) => `${c.id} "${c.name}" (${c.unitIds.length} regions) — ${c.pattern}\n  recommended: ${c.recommendedLabels.map((l) => `${l} (score ${c.labelScores.find((s) => s.label === l)?.score.toFixed(2)}): ${c.rationales?.[l] || ''}`).join(' | ')}`).join('\n')}
Score how urgently the annotator should inspect each cluster, 0–1. Raise priority for clusters that are ambiguous (close or low label scores, uncertain rationales), relevant (meaningful for implicit cultural meaning), or high-impact (many regions / artworks affected). Give a short reason naming which of these applies.
JSON: {"priorities":[{"cluster_id":"${clusters[0].id}","score":0.7,"reason":"ambiguous: ..."}]}`,
    schema: PrioritySchema,
    check: checkAllClusters(clusters, 'cluster_id', 'priorities'),
  });
  return Object.fromEntries(v.priorities.map((p) => [p.cluster_id, { score: p.score, reason: p.reason }]));
}

const PickSchema = z.object({ priority_cluster_ids: z.array(z.string()).min(1) });
export async function selectPriorityClusters(clusters) {
  const v = await callModelJson({
    system: LABEL_SYS,
    prompt: `Clusters with recommendations and inspection priority:
${clusters.map((c) => `${c.id} "${c.name}" — labels: ${c.recommendedLabels.join(', ')}; priority ${c.priority.score.toFixed(2)} (${c.priority.reason})`).join('\n')}
Put forward the clusters the annotator should inspect, most important first (usually 2–5; include all whose inspection would change decisions).
JSON: {"priority_cluster_ids":["${clusters[0].id}"]}`,
    schema: PickSchema,
    check: (x) => { const bad = x.priority_cluster_ids.filter((id) => !clusters.find((c) => c.id === id)); return bad.length ? `unknown clusters ${bad.join(', ')}` : null; },
  });
  return [...new Set(v.priority_cluster_ids)];
}

// ---------- pipelines ----------
async function step(task, name, fn) {
  const st = { name, status: 'running', startedAt: Date.now() };
  task.steps.push(st); save();
  try { const r = await fn(); st.status = 'done'; st.endedAt = Date.now(); save(); return r; }
  catch (e) { st.status = 'error'; st.error = e.message; task.status = 'error'; save(); throw e; }
}

/** Process 2 after human select: tool_2, tool_3, model_3 ×3, model_4 ×5. */
export async function runRecommendPipeline(task) {
  task.status = 'analysing'; task.steps = task.steps.filter((s) => s.phase === 'skills'); save();
  const text = await step(task, 'tool_2 translate · text embeddings', async () => computeTextEmbeddings());
  const image = await step(task, 'tool_3 translate · image embeddings', () => computeImageEmbeddings());
  const emb = { text, image, unitIds: allUnits().map((u) => u.id) };
  task.clustersInitial = await step(task, 'model_3 assign · clusters', () => assignClusters(task, emb));
  let clusters = await step(task, 'model_3 modify · refine clusters', () => refineClusters(task, task.clustersInitial));
  task.clusters = clusters; save();
  await finishClusters(task, clusters, { priorities: true });
}

/** Process 7 after human select: model_3 assign → generate, model_4 evaluate → select → generate. */
export async function runReusePipeline(task) {
  task.status = 'analysing'; task.steps = task.steps.filter((s) => s.phase === 'skills'); save();
  const clusters = await step(task, 'model_3 assign · clusters', () => assignClusters(task, null));
  task.clusters = clusters; save();
  await finishClusters(task, clusters, { priorities: false });
}

async function finishClusters(task, clusters, { priorities }) {
  const patterns = await step(task, 'model_3 generate · cluster patterns', () => describePatterns(task, clusters));
  clusters.forEach((c) => (c.pattern = patterns[c.id])); save();
  const scores = await step(task, 'model_4 evaluate · label scores', () => scoreLabels(clusters, true));
  clusters.forEach((c) => (c.labelScores = scores[c.id] || [])); save();
  const rec = await step(task, 'model_4 select · recommended labels', () => selectLabels(clusters));
  clusters.forEach((c) => (c.recommendedLabels = rec[c.id] || [])); save();
  const rat = await step(task, 'model_4 generate · rationales', () => writeRationales(clusters, true));
  clusters.forEach((c) => (c.rationales = rat[c.id] || {})); save();
  if (priorities) {
    const pr = await step(task, 'model_4 evaluate · cluster priorities', () => scorePriorities(clusters));
    clusters.forEach((c) => (c.priority = pr[c.id])); save();
    task.priorityClusterIds = await step(task, 'model_4 select · priority clusters', () => selectPriorityClusters(clusters));
  } else {
    task.priorityClusterIds = [];
  }
  task.status = 'review'; save();
}
