// Model steps. One prompt per operation, built only from the representations
// in the state that precedes the step in design.json.
import { callModel } from './model.js';

const fmtProfile = (r4) => JSON.stringify(r4, null, 2);
const fmtGuidelines = (list) =>
  list.map((g) => `- id: ${g.id}\n  title: ${g.title}\n  applies when: ${g.when || '(always)'}\n  instruction: ${g.instruction}`).join('\n');

// ---------------------------------------------------------------------------
// model_1 match : r4 + r2_1* + r3_1 -> r5* (selection record*)
const MATCH_SCHEMA = {
  type: 'object',
  properties: {
    matches: {
      type: 'array',
      items: {
        type: 'object',
        properties: { guideline_id: { type: 'string' }, reason: { type: 'string' } },
        required: ['guideline_id', 'reason'],
      },
    },
  },
  required: ['matches'],
};

export async function matchGuidelines({ r4, r2, r3 }) {
  if (!r2.length) return [];
  const out = await callModel({
    system:
      'You match a data-analysis request against a library of analysis guidelines. ' +
      'Select only guidelines whose "applies when" condition holds for this request and dataset. ' +
      'Return guideline ids exactly as given. Each reason is one short sentence citing the request or a column.',
    prompt:
      `REQUEST:\n${r3}\n\nDATA PROFILE:\n${fmtProfile(r4)}\n\nGUIDELINE LIBRARY:\n${fmtGuidelines(r2)}\n\n` +
      'Return the relevant guidelines (possibly none).',
    schema: MATCH_SCHEMA,
  });
  // Enforce: a selection must refer into r2, no duplicates.
  const ids = new Set(r2.map((g) => g.id));
  const seen = new Set();
  return (out.matches || []).filter((m) => {
    if (!ids.has(m.guideline_id) || seen.has(m.guideline_id)) return false;
    seen.add(m.guideline_id);
    return true;
  }).map((m) => ({ guideline_id: m.guideline_id, reason: String(m.reason || '').trim() }));
}

// ---------------------------------------------------------------------------
// model_2 modify~ : r4 + r2_1* + r3_1 + r5* -> r3_2 + r6*
const VERDICTS = ['applied', 'partially_applied', 'not_applicable'];
const REFINE_SCHEMA = {
  type: 'object',
  properties: {
    refined_request: { type: 'string' },
    evaluations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          guideline_id: { type: 'string' },
          verdict: { type: 'string', enum: VERDICTS },
          note: { type: 'string' },
        },
        required: ['guideline_id', 'verdict', 'note'],
      },
    },
  },
  required: ['refined_request', 'evaluations'],
};

export async function refineRequest({ r4, r2, r3, r5 }) {
  const byId = new Map(r2.map((g) => [g.id, g]));
  const matched = r5.map((s) => byId.get(s.guideline_id)).filter(Boolean);
  const out = await callModel({
    system:
      'You rewrite a data-analysis request so that it follows the selected guidelines. ' +
      'The rewritten request will be handed to a code generator that sees NOTHING else, so it must be ' +
      'self-contained: name the data file and its format, list the exact column names (and types) it needs, ' +
      'and spell out each guideline-driven step concretely. Keep the user\'s intent; do not add analyses ' +
      'the user did not ask for beyond what guidelines require. Write it as a numbered plan in plain prose. ' +
      'Then evaluate, for every selected guideline, how the rewrite handled it.',
    prompt:
      `ORIGINAL REQUEST:\n${r3}\n\nDATA PROFILE (file "${r4.name}", ${r4.format}):\n${fmtProfile(r4)}\n\n` +
      `SELECTED GUIDELINES:\n${matched.length ? fmtGuidelines(matched) : '(none)'}\n\n` +
      'Return the refined request and one evaluation per selected guideline.',
    schema: REFINE_SCHEMA,
  });
  const refined = String(out.refined_request || '').trim();
  if (!refined) throw new Error('Model returned an empty refined request');
  const matchedIds = new Set(matched.map((g) => g.id));
  const evals = new Map();
  for (const e of out.evaluations || []) {
    if (matchedIds.has(e.guideline_id) && VERDICTS.includes(e.verdict) && !evals.has(e.guideline_id)) {
      evals.set(e.guideline_id, { guideline_id: e.guideline_id, verdict: e.verdict, note: String(e.note || '').trim() });
    }
  }
  // Every matched guideline gets an evaluation, even if the model omitted it.
  for (const id of matchedIds) {
    if (!evals.has(id)) evals.set(id, { guideline_id: id, verdict: 'not_applicable', note: 'The model did not report on this guideline.' });
  }
  return { r3_2: refined, r6: [...evals.values()] };
}

// ---------------------------------------------------------------------------
// model_4 generate~ : r3_2 -> r7 (artifact formal: Python)
const CODE_SCHEMA = {
  type: 'object',
  properties: { language: { type: 'string', enum: ['python'] }, code: { type: 'string' } },
  required: ['language', 'code'],
};

export async function generateCode({ r3 }) {
  const out = await callModel({
    system:
      'You write a single, runnable Python 3 script using pandas (and matplotlib only if a chart is requested) ' +
      'that carries out the given analysis request exactly. Load the data file named in the request from the ' +
      'current directory. Use only the column names stated in the request. Comment each numbered step. ' +
      'Return only the code in the "code" field, without Markdown fences.',
    prompt: `ANALYSIS REQUEST:\n${r3}`,
    schema: CODE_SCHEMA,
  });
  let code = String(out.code || '').trim();
  const fence = code.match(/^```[a-zA-Z]*\n([\s\S]*?)\n```$/);
  if (fence) code = fence[1];
  if (!code) throw new Error('Model returned empty code');
  if (!/\bimport\b/.test(code)) throw new Error('Generated output does not look like a Python script (no imports)');
  return { language: 'python', code };
}

// ---------------------------------------------------------------------------
// model_3 generate~ : r3_1 + r4 + r5* + r2_1* -> r8*
const SUGGEST_SCHEMA = {
  type: 'object',
  properties: {
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          when: { type: 'string' },
          instruction: { type: 'string' },
          rationale: { type: 'string' },
        },
        required: ['title', 'when', 'instruction', 'rationale'],
      },
    },
  },
  required: ['suggestions'],
};

export async function suggestGuidelines({ r3, r4, r5, r2 }) {
  const byId = new Map(r2.map((g) => [g.id, g]));
  const matched = r5.map((s) => byId.get(s.guideline_id)).filter(Boolean);
  const out = await callModel({
    system:
      'You propose new reusable data-analysis guidelines for a team library. A guideline has a short title, ' +
      'an "applies when" condition, and an imperative instruction. Propose 2 to 4 guidelines that this request ' +
      'and dataset reveal a need for, that are general enough to reuse on other datasets, and that do not ' +
      'duplicate or contradict any existing guideline. Give a one-sentence rationale for each.',
    prompt:
      `REQUEST:\n${r3}\n\nDATA PROFILE:\n${fmtProfile(r4)}\n\n` +
      `GUIDELINES ALREADY MATCHED TO THIS REQUEST:\n${matched.length ? fmtGuidelines(matched) : '(none)'}\n\n` +
      `FULL EXISTING LIBRARY:\n${r2.length ? fmtGuidelines(r2) : '(empty)'}`,
    schema: SUGGEST_SCHEMA,
  });
  const existing = new Set(r2.map((g) => g.title.trim().toLowerCase()));
  return (out.suggestions || [])
    .map((s) => ({
      title: String(s.title || '').trim().slice(0, 120),
      when: String(s.when || '').trim(),
      instruction: String(s.instruction || '').trim(),
      rationale: String(s.rationale || '').trim(),
    }))
    .filter((s) => s.title && s.instruction && !existing.has(s.title.toLowerCase()))
    .slice(0, 6);
}
