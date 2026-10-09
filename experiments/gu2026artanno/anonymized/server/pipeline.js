// Model steps (model_1 … model_10) and process orchestration.
// Each model step: one prompt, built only from the representations in the preceding state,
// with validated JSON output.
import path from 'node:path';
import { callModel } from './llm.js';
import { getState, save, pushVersion, log, labelSpace, IMAGE_DIR } from './store.js';
import {
  tool1Extract, tool2EmbedCaptions, tool3EmbedGuidelines, similarities,
  oneOf, clamp01, byImage,
} from './tools.js';

const J = (x) => JSON.stringify(x, null, 1);
const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
const leafConcepts = (tax) => tax.nodes.filter((n) => !tax.nodes.some((m) => m.parent === n.id));
const taxonomyOutline = (tax) => {
  const lines = [];
  const walk = (parent, depth) => tax.nodes.filter((n) => (n.parent || null) === parent)
    .forEach((n) => { lines.push(`${'  '.repeat(depth)}- ${n.id}: ${n.name}`); walk(n.id, depth + 1); });
  walk(null, 0);
  return lines.join('\n');
};
const textOf = (arr, imageId) => arr.find((x) => x.imageId === imageId)?.text || '';

// ---------------- Process 1 ----------------

/** model_1 generate~: images (r1) + regions (r3) + object labels (r4) -> captions (r5) + descriptions (r6). */
export async function model1Describe(images, regions, objectLabels) {
  const batches = chunk(images, 4);
  const results = await Promise.all(batches.map((batch) => {
    const objects = batch.map((img) => ({
      imageId: img.id,
      file: path.join(IMAGE_DIR, img.file),
      size: [img.width, img.height],
      objects: regions.filter((r) => r.imageId === img.id).map((r) => ({
        label: objectLabels.find((l) => l.regionId === r.id)?.label, bbox: r.bbox,
      })),
    }));
    return callModel({
      role: 'model_1',
      system: 'You are an image describer for a data labeling tool. Describe only what is visible.',
      images: objects.map((o) => o.file),
      prompt: `For each image, write:
- "caption": one sentence (max 20 words) summarising the scene;
- "description": 3-5 sentences describing objects, their positions and relations, referring to the annotated regions (bbox = [x,y,w,h] in pixels).
Images and annotated regions:
${J(objects)}
Return [{"imageId": "...", "caption": "...", "description": "..."}] for every image.`,
      validate: (v) => byImage(v, batch.map((b) => b.id), (x) => {
        if (!x.caption || !x.description) throw new Error('caption/description missing');
        return { caption: String(x.caption), description: String(x.description) };
      }),
    });
  }));
  const flat = results.flat();
  return {
    captions: flat.map((r) => ({ imageId: r.imageId, text: r.caption })),
    descriptions: flat.map((r) => ({ imageId: r.imageId, text: r.description })),
  };
}

export async function process1() {
  const s = getState();
  log('P1 tool_1 extract: annotations -> regions + object labels');
  Object.assign(s, tool1Extract(s.images, s.annotations));
  save();
  log(`P1 model_1 generate: describing ${s.images.length} images`);
  Object.assign(s, await model1Describe(s.images, s.regions, s.objectLabels));
  save();
  log('P1 done');
}

// ---------------- Process 2 / 7 ----------------

/** model_2 select: instruction (r7) + captions (r5) + descriptions (r6) + guidelines (r8) + profile (r9) + taxonomy (r10) -> suggested guidelines (r11). */
export async function model2SelectGuidelines(s) {
  const ids = s.guidelines.current.map((g) => g.id);
  const out = await callModel({
    role: 'model_2',
    system: 'You select which labeling guidelines are relevant to a labeling task.',
    prompt: `Labeling instruction:\n${s.instruction.current}

User profile:\n${J(s.profile.current)}

Concept taxonomy:\n${taxonomyOutline(s.taxonomy)}

Dataset captions:\n${s.captions.map((c) => `- ${c.imageId}: ${c.text}`).join('\n')}

Guideline library:\n${J(s.guidelines.current)}

Pick the guidelines that should be applied to this dataset for this instruction.
Return [{"guidelineId": "...", "reason": "short reason"}], most relevant first.`,
    validate: (v) => {
      if (!Array.isArray(v)) throw new Error('expected array');
      return v.filter((x) => ids.includes(x.guidelineId))
        .map((x) => ({ guidelineId: x.guidelineId, reason: String(x.reason || '') }));
    },
  });
  return out;
}

/** model_3 assign: descriptions (r6) + active guidelines (r12) + profile (r9) [+ similarity of r13 to r14] -> task labels (r15_1). */
export async function model3Assign(s, sims) {
  const active = s.guidelines.current.filter((g) => s.activeGuidelines.includes(g.id));
  const labels = labelSpace(s);
  const ids = s.images.map((i) => i.id);
  return callModel({
    role: 'model_3',
    system: 'You are a careful data labeler that applies written guidelines.',
    prompt: `Instruction:\n${s.instruction.current}

Guidelines to apply:\n${J(active)}

User profile:\n${J(s.profile.current)}

Allowed labels: ${labels.join(', ')}

Images:\n${ids.map((id) => {
      const sim = sims?.find((x) => x.imageId === id);
      const hint = sim ? `\n  most similar guidelines (cosine): ${sim.scores.slice(0, 3).map((x) => `${x.guidelineId}=${x.sim}`).join(', ')}` : '';
      return `- ${id}: ${textOf(s.descriptions, id)}${hint}`;
    }).join('\n')}

Assign exactly one allowed label to each image. Return [{"imageId": "...", "label": "..."}].`,
    validate: (v) => byImage(v, ids, (x) => ({ label: oneOf(x.label, labels) })),
  });
}

/** model_3 modify: refine task labels for consistency (r15_1 -> r15_2). */
export async function model3Refine(s) {
  const active = s.guidelines.current.filter((g) => s.activeGuidelines.includes(g.id));
  const labels = labelSpace(s);
  const ids = s.images.map((i) => i.id);
  return callModel({
    role: 'model_3',
    system: 'You are a careful data labeler that applies written guidelines.',
    prompt: `Instruction:\n${s.instruction.current}

Guidelines:\n${J(active)}
User profile:\n${J(s.profile.current)}
Allowed labels: ${labels.join(', ')}

Current labels with image descriptions:
${ids.map((id) => `- ${id} [${s.taskLabels.current.find((l) => l.imageId === id)?.label}]: ${textOf(s.descriptions, id)}`).join('\n')}

Review the labels as a set: fix labels that contradict the guidelines or are inconsistent with how similar images were labeled.
Return all images: [{"imageId": "...", "label": "...", "changed": true|false}].`,
    validate: (v) => byImage(v, ids, (x) => ({ label: oneOf(x.label, labels) })),
  });
}

/** model_3 generate~: rationale per image (r16) from descriptions (r6) + labels (r15) + guidelines (r12). */
export async function model3Rationales(s) {
  const active = s.guidelines.current.filter((g) => s.activeGuidelines.includes(g.id));
  const ids = s.images.map((i) => i.id);
  return callModel({
    role: 'model_3',
    system: 'You are a careful data labeler that applies written guidelines.',
    prompt: `Guidelines:\n${J(active)}

For each image, write a 1-2 sentence rationale explaining why it has its label, citing guideline ids.
${ids.map((id) => `- ${id} [${s.taskLabels.current.find((l) => l.imageId === id)?.label}]: ${textOf(s.descriptions, id)}`).join('\n')}

Return [{"imageId": "...", "rationale": "..."}].`,
    validate: (v) => byImage(v, ids, (x) => {
      if (!x.rationale) throw new Error('rationale missing');
      return { text: String(x.rationale) };
    }),
  });
}

/** model_4 evaluate: score each rationale (r17) in [0,1]. */
export async function model4ScoreRationales(s) {
  const ids = s.images.map((i) => i.id);
  return callModel({
    role: 'model_4',
    system: 'You are a strict quality reviewer for labeled data.',
    prompt: `Instruction:\n${s.instruction.current}
User profile:\n${J(s.profile.current)}

For each labeled image, rate how well the rationale supports the label (0 = unsupported, 1 = fully supported):
${ids.map((id) => `- ${id} label=${s.taskLabels.current.find((l) => l.imageId === id)?.label}: ${textOf(s.rationales, id)}`).join('\n')}

Return [{"imageId": "...", "score": 0.0-1.0}].`,
    validate: (v) => byImage(v, ids, (x) => ({ score: clamp01(x.score) })),
  });
}

/** model_4 select: choose a taxonomy concept (leaf of r10) per image -> concept labels (r18). */
export async function model4SelectConcepts(s) {
  const ids = s.images.map((i) => i.id);
  const leaves = leafConcepts(s.taxonomy).map((n) => n.id);
  return callModel({
    role: 'model_4',
    system: 'You are a strict quality reviewer for labeled data.',
    prompt: `Concept taxonomy (choose leaves only):\n${taxonomyOutline(s.taxonomy)}

For each image pick the single best-fitting leaf concept, using its label, rationale and rationale score:
${ids.map((id) => `- ${id} label=${s.taskLabels.current.find((l) => l.imageId === id)?.label} score=${s.rationaleScores.find((r) => r.imageId === id)?.score ?? 'n/a'}: ${textOf(s.rationales, id)}`).join('\n')}

Return [{"imageId": "...", "conceptId": "..."}].`,
    validate: (v) => byImage(v, ids, (x) => ({ conceptId: oneOf(x.conceptId, leaves) })),
  });
}

/** model_4 generate~: a note for the human reviewer per image (r19). */
export async function model4ReviewNotes(s) {
  const ids = s.images.map((i) => i.id);
  const name = (cid) => s.taxonomy.nodes.find((n) => n.id === cid)?.name || cid;
  return callModel({
    role: 'model_4',
    system: 'You are a strict quality reviewer for labeled data.',
    prompt: `Write a short note (max 25 words) for the human reviewer of each image: what to double-check before accepting the label.
${ids.map((id) => `- ${id} label=${s.taskLabels.current.find((l) => l.imageId === id)?.label} concept=${name(s.conceptLabels.find((c) => c.imageId === id)?.conceptId)}${s.rationales.length ? `: ${textOf(s.rationales, id)}` : ''}`).join('\n')}

Return [{"imageId": "...", "note": "..."}].`,
    validate: (v) => byImage(v, ids, (x) => {
      if (!x.note) throw new Error('note missing');
      return { text: String(x.note) };
    }),
  });
}

/** model_4 evaluate: uncertainty score per image from its note (r20). */
export async function model4ScoreNotes(s) {
  const ids = s.images.map((i) => i.id);
  return callModel({
    role: 'model_4',
    system: 'You are a strict quality reviewer for labeled data.',
    prompt: `For each image, estimate how likely the label is wrong (0 = certainly right, 1 = likely wrong), given the reviewer note and rationale:
${ids.map((id) => `- ${id} label=${s.taskLabels.current.find((l) => l.imageId === id)?.label}; rationale: ${textOf(s.rationales, id)}; note: ${textOf(s.reviewNotes, id)}`).join('\n')}

Return [{"imageId": "...", "score": 0.0-1.0}].`,
    validate: (v) => byImage(v, ids, (x) => ({ score: clamp01(x.score) })),
  });
}

/** model_4 select: review priority per image (r21). */
export async function model4SelectQueue(s) {
  const ids = s.images.map((i) => i.id);
  const out = await callModel({
    role: 'model_4',
    system: 'You are a strict quality reviewer for labeled data.',
    prompt: `Decide which images a human must review ("review") and which can be auto-accepted ("auto").
Send to review anything uncertain, contradictory, or "unclear"; at least one image must be "review".
${ids.map((id) => `- ${id} label=${s.taskLabels.current.find((l) => l.imageId === id)?.label} uncertainty=${s.noteScores.find((x) => x.imageId === id)?.score}; note: ${textOf(s.reviewNotes, id)}`).join('\n')}

Return [{"imageId": "...", "priority": "review"|"auto"}].`,
    validate: (v) => byImage(v, ids, (x) => ({ priority: oneOf(x.priority, ['review', 'auto']) })),
  });
  if (!out.some((x) => x.priority === 'review')) {
    const worst = [...s.noteScores].sort((a, b) => b.score - a.score)[0];
    if (worst) out.find((x) => x.imageId === worst.imageId).priority = 'review';
  }
  return out;
}

/** Process 2, first step (model_2 select). The human select happens in the UI. */
export async function process2Suggest() {
  const s = getState();
  log('P2 model_2 select: suggesting guidelines');
  s.suggestedGuidelines = await model2SelectGuidelines(s);
  s.activeGuidelines = s.suggestedGuidelines.map((g) => g.guidelineId);
  save();
}

function clearLabelRun(s) {
  Object.assign(s, { rationales: [], rationaleScores: [], conceptLabels: [], reviewNotes: [], noteScores: [], reviewQueue: [] });
}

/** Process 2, after human select (r12): tool_2 … model_4 select. */
export async function process2Run(activeGuidelines) {
  const s = getState();
  s.activeGuidelines = activeGuidelines;
  clearLabelRun(s);
  log('P2 tool_2 translate: caption vectors');
  s.captionVectors = tool2EmbedCaptions(s.captions);
  log('P2 tool_3 translate: guideline vectors');
  s.guidelineVectors = tool3EmbedGuidelines(s.guidelines.current.filter((g) => activeGuidelines.includes(g.id)));
  save();
  log('P2 model_3 assign: task labels');
  pushVersion('taskLabels', await model3Assign(s, similarities(s.captionVectors, s.guidelineVectors)), { step: 'P2 model_3 assign' });
  log('P2 model_3 modify: refining labels');
  pushVersion('taskLabels', await model3Refine(s), { step: 'P2 model_3 modify' });
  log('P2 model_3 generate: rationales');
  s.rationales = await model3Rationales(s); save();
  log('P2 model_4 evaluate: rationale scores');
  s.rationaleScores = await model4ScoreRationales(s); save();
  log('P2 model_4 select: taxonomy concepts');
  s.conceptLabels = await model4SelectConcepts(s); save();
  log('P2 model_4 generate: reviewer notes');
  s.reviewNotes = await model4ReviewNotes(s); save();
  log('P2 model_4 evaluate: uncertainty');
  s.noteScores = await model4ScoreNotes(s); save();
  log('P2 model_4 select: review queue');
  s.reviewQueue = await model4SelectQueue(s);
  s.lastRun = 'p2';
  save();
  log('P2 done');
}

/** Process 7, first step: model_2 select with the edited instruction (r7_2). */
export async function process7Suggest(instruction) {
  const s = getState();
  if (instruction && instruction !== s.instruction.current) pushVersion('instruction', instruction);
  log('P7 model_2 select: suggesting guidelines for edited instruction');
  s.suggestedGuidelines = await model2SelectGuidelines(s);
  s.activeGuidelines = s.suggestedGuidelines.map((g) => g.guidelineId);
  save();
}

/** Process 7, after human select: model_3 assign, generate; model_4 evaluate, select, generate. */
export async function process7Run(activeGuidelines) {
  const s = getState();
  s.activeGuidelines = activeGuidelines;
  clearLabelRun(s);
  s.captionVectors = []; s.guidelineVectors = [];
  log('P7 model_3 assign: task labels');
  pushVersion('taskLabels', await model3Assign(s, null), { step: 'P7 model_3 assign' });
  log('P7 model_3 generate: rationales');
  s.rationales = await model3Rationales(s); save();
  log('P7 model_4 evaluate: rationale scores');
  s.rationaleScores = await model4ScoreRationales(s); save();
  log('P7 model_4 select: taxonomy concepts');
  s.conceptLabels = await model4SelectConcepts(s); save();
  log('P7 model_4 generate: reviewer notes');
  s.reviewNotes = await model4ReviewNotes(s);
  s.lastRun = 'p7';
  save();
  log('P7 done');
}

// ---------------- Process 4 ----------------

/** model_5 generate~: answer a question (r27) about a selected image (r26) -> reply (r28). */
export async function model5Answer(s, imageId, question) {
  const img = s.images.find((i) => i.id === imageId);
  const labels = labelSpace(s);
  const concept = s.conceptLabels.find((c) => c.imageId === imageId)?.conceptId;
  const out = await callModel({
    role: 'model_5',
    system: 'You are a labeling assistant answering a human reviewer\'s question about one image.',
    images: [path.join(IMAGE_DIR, img.file)],
    prompt: `Image ${imageId}.
Model task label: ${s.taskLabels.current.find((l) => l.imageId === imageId)?.label}
Concept: ${s.taxonomy.nodes.find((n) => n.id === concept)?.name || 'n/a'}
Current human label: ${s.finalLabels.find((l) => l.imageId === imageId)?.label || 'none'}
Allowed labels: ${labels.join(', ')}

Reviewer's question:\n${question}

Answer in at most 120 words, and suggest the label you think fits best.
Return {"answer": "...", "suggestedLabel": "..."}.`,
    validate: (v) => {
      if (!v || !v.answer) throw new Error('answer missing');
      return { text: String(v.answer), suggestedLabel: oneOf(v.suggestedLabel, labels, 'unclear') };
    },
  });
  return { imageId, question, ...out };
}

// ---------------- Process 5 ----------------

export async function process5() {
  const s = getState();
  const examples = s.labeledExamples;
  if (!examples.length) throw new Error('No labeled examples yet — review some images first.');
  log('P5 model_6 extract: patterns per label');
  s.patterns = await callModel({
    role: 'model_6',
    system: 'You analyse human-labeled examples to find what distinguishes each label.',
    prompt: `Labeled examples (label, model label, caption, rationale, reviewer verdict/comment, Q&A):
${J(examples.map(({ imageId, ...e }) => e))}

For each label, extract the visual/semantic features that human decisions depend on, especially where the human disagreed with the model.
Return [{"label": "...", "features": ["...", "..."]}].`,
    validate: (v) => {
      if (!Array.isArray(v)) throw new Error('expected array');
      return v.filter((x) => x.label && Array.isArray(x.features)).map((x) => ({ label: String(x.label), features: x.features.map(String) }));
    },
  });
  save();
  log('P5 model_7 generate: candidate guidelines');
  const raw = await callModel({
    role: 'model_7',
    system: 'You write concise, testable labeling guidelines.',
    prompt: `Patterns found in human labels:\n${J(s.patterns)}

Write candidate labeling guidelines. Each: a short name, a one-sentence rule ("If ..., label ..."), and the label it implies.
Return [{"name": "...", "rule": "...", "label": "..."}].`,
    validate: (v) => {
      if (!Array.isArray(v) || !v.length) throw new Error('expected non-empty array');
      return v.filter((x) => x.name && x.rule && x.label);
    },
  });
  s.candidateRules = raw.map((r, i) => ({ id: `cand${i + 1}`, name: String(r.name), rule: String(r.rule), label: String(r.label).toLowerCase() }));
  save();
  log('P5 model_8 match: candidates vs library');
  const libIds = s.guidelines.current.map((g) => g.id);
  s.ruleMatches = await callModel({
    role: 'model_8',
    system: 'You curate a library of labeling guidelines.',
    prompt: `Existing guideline library:\n${J(s.guidelines.current)}

Candidate guidelines:\n${J(s.candidateRules)}

For each candidate, find the existing guideline that covers the same situation, or null.
Return [{"candidateId": "...", "guidelineId": "..." | null}].`,
    validate: (v) => s.candidateRules.map((c) => {
      const m = Array.isArray(v) ? v.find((x) => x.candidateId === c.id) : null;
      if (!m) throw new Error(`missing ${c.id}`);
      return { candidateId: c.id, guidelineId: libIds.includes(m.guidelineId) ? m.guidelineId : null };
    }),
  });
  save();
  log('P5 model_8 evaluate: add / merge / skip');
  s.ruleAssessments = await callModel({
    role: 'model_8',
    system: 'You curate a library of labeling guidelines.',
    prompt: `Existing guideline library:\n${J(s.guidelines.current)}

Candidates with their matched existing guideline:
${J(s.candidateRules.map((c) => ({ ...c, matches: s.ruleMatches.find((m) => m.candidateId === c.id)?.guidelineId })))}

Judge each candidate: "add" (new, useful), "merge" (refines its matched guideline), or "skip" (redundant or not useful).
Return [{"candidateId": "...", "action": "add"|"merge"|"skip", "reason": "..."}].`,
    validate: (v) => s.candidateRules.map((c) => {
      const a = Array.isArray(v) ? v.find((x) => x.candidateId === c.id) : null;
      if (!a) throw new Error(`missing ${c.id}`);
      return { candidateId: c.id, action: oneOf(a.action, ['add', 'merge', 'skip']), reason: String(a.reason || '') };
    }),
  });
  save();
  log('P5 model_8 modify: updating guideline library');
  const updated = await callModel({
    role: 'model_8',
    system: 'You curate a library of labeling guidelines.',
    prompt: `Existing guideline library:\n${J(s.guidelines.current)}

Apply these decisions to produce the updated library. Keep ids of existing guidelines; "merge" rewrites the matched guideline's rule; "add" appends a new guideline with a new id like "g<number>"; "skip" changes nothing.
${J(s.candidateRules.map((c) => ({ ...c, ...s.ruleAssessments.find((a) => a.candidateId === c.id), matches: s.ruleMatches.find((m) => m.candidateId === c.id)?.guidelineId })))}

Return the full updated library: [{"id": "...", "name": "...", "rule": "...", "label": "..."}].`,
    validate: (v) => {
      if (!Array.isArray(v)) throw new Error('expected array');
      const lib = v.filter((g) => g.id && g.name && g.rule && g.label)
        .map((g) => ({ id: String(g.id), name: String(g.name), rule: String(g.rule), label: String(g.label).toLowerCase() }));
      for (const old of s.guidelines.current) if (!lib.some((g) => g.id === old.id)) throw new Error(`guideline ${old.id} was dropped`);
      if (new Set(lib.map((g) => g.id)).size !== lib.length) throw new Error('duplicate ids');
      return lib;
    },
  });
  pushVersion('guidelines', updated, { step: 'P5 model_8 modify' });
  log('P5 done');
}

// ---------------- Process 6 ----------------

export async function process6() {
  const s = getState();
  if (!s.labeledExamples.length) throw new Error('No labeled examples yet — review some images first.');
  log('P6 model_9 extract: preference summary');
  const sum = await callModel({
    role: 'model_9',
    system: 'You infer a labeler\'s preferences from their decisions.',
    prompt: `Current user profile:\n${J(s.profile.current)}

Final human labels:\n${J(s.finalLabels)}
Labeled examples:\n${J(s.labeledExamples.map(({ imageId, ...e }) => e))}

Summarise, in one paragraph, how this person labels: what they are strict or lenient about and where they override the model.
Return {"summary": "..."}.`,
    validate: (v) => { if (!v?.summary) throw new Error('summary missing'); return String(v.summary); },
  });
  s.preferenceSummary = sum; save();
  log('P6 model_10 modify: updating profile');
  const profile = await callModel({
    role: 'model_10',
    system: 'You maintain a structured user profile for a labeling assistant.',
    prompt: `Current profile:\n${J(s.profile.current)}

New preference summary:\n${sum}

Update the profile: keep still-valid preferences, revise contradicted ones, add new ones (each a short imperative sentence), and rewrite the summary.
Return {"preferences": ["..."], "summary": "..."}.`,
    validate: (v) => {
      if (!Array.isArray(v?.preferences) || typeof v.summary !== 'string') throw new Error('invalid profile');
      return { preferences: v.preferences.map(String), summary: v.summary };
    },
  });
  pushVersion('profile', profile, { step: 'P6 model_10 modify' });
  log('P6 done');
}
