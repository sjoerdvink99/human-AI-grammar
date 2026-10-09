// [model …] steps. One prompt per operation, built only from the representations in the preceding state.
import { callModelJSON } from './llm.js';
import { describeRecord, describeBaseline } from './records.js';

export const STYLES = {
  poem: 'a short free-verse poem (8–16 lines)',
  letter_to_future_self: 'a warm letter addressed to my future self, one year from now',
  short_story: 'a third-person short story (150–250 words) about this day',
  bullet_summary: 'a concise bullet-point summary (4–7 bullets) of the day and what I learned',
  gratitude_note: 'a gratitude note listing what I am thankful for from this day',
};

const SYSTEM =
  'You are a thoughtful journaling companion. You only use facts present in the provided data and writing; never invent events, people, or places. Respond with a single JSON object and nothing else.';

const nonEmpty = (s, max) => {
  if (typeof s !== 'string' || !s.trim()) throw new Error('empty text');
  return s.trim().slice(0, max);
};

function validatePrompts(json) {
  if (!Array.isArray(json.prompts)) throw new Error('prompts must be an array');
  const prompts = json.prompts.map((p) => nonEmpty(p, 240)).filter(Boolean);
  if (prompts.length < 3) throw new Error('need at least 3 prompts');
  return prompts.slice(0, 5);
}

/**
 * P1 [model generate]~ : r1* + r2 -> r3*   (no query, no previous entry)
 * P3 [model generate]~ : r5 + r2_2 + r8 -> r3_2*
 */
export function generatePrompts({ records, record, query, entry }) {
  const parts = [
    'Write 4 reflection questions that help me journal about one day, grounded in my personal data for that day.',
    'Questions should be open-ended, specific to the data (mention concrete numbers, events or places), and each under 200 characters.',
    '',
    'DAY DATA:',
    describeRecord(record),
  ];
  if (records) parts.push('', 'MY USUAL PATTERNS:', describeBaseline(records));
  if (query) parts.push('', `I PICKED THIS DAY BY DESCRIBING IT AS: "${query}"`, 'Let that description shape the questions.');
  if (entry) parts.push('', 'MY PREVIOUS JOURNAL ENTRY (for continuity; avoid repeating its questions):', entry);
  parts.push('', 'Return JSON: {"prompts": ["question 1", "question 2", "question 3", "question 4"]}');
  return callModelJSON(parts.join('\n'), validatePrompts, { system: SYSTEM });
}

/** P1 [model compose]~ : r1* + r2 + r3* + r4 -> r5 */
export function composeEntry({ records, record, prompts, response }) {
  const prompt = [
    'Compose a first-person journal entry (120–220 words) for the day below.',
    'Weave together my own reflection (primary source — keep my voice and claims) with relevant facts from the data.',
    'Use the reflection questions only as guidance for what to cover.',
    '',
    'DAY DATA:',
    describeRecord(record),
    '',
    'MY USUAL PATTERNS:',
    describeBaseline(records),
    '',
    'REFLECTION QUESTIONS:',
    ...prompts.map((p, i) => `${i + 1}. ${p}`),
    '',
    'MY REFLECTION:',
    response,
    '',
    'Return JSON: {"title": "short title", "entry": "the journal entry"}',
  ].join('\n');
  return callModelJSON(prompt, (j) => ({ title: nonEmpty(j.title, 120), entry: nonEmpty(j.entry, 4000) }), { system: SYSTEM });
}

/** P2 [model compose]~ : r2 + r4 + r5 + r6 -> r7 */
export function restyleEntry({ record, response, entry, style }) {
  if (!STYLES[style]) throw new Error(`Unknown style "${style}"`);
  const prompt = [
    `Rewrite my journal entry as ${STYLES[style]}.`,
    'Keep every fact consistent with the entry, my reflection and the data. Do not add new events.',
    '',
    'DAY DATA:',
    describeRecord(record),
    '',
    'MY REFLECTION:',
    response,
    '',
    'JOURNAL ENTRY:',
    entry,
    '',
    'Return JSON: {"text": "the rewritten piece"}',
  ].join('\n');
  return callModelJSON(prompt, (j) => ({ text: nonEmpty(j.text, 5000) }), { system: SYSTEM });
}
