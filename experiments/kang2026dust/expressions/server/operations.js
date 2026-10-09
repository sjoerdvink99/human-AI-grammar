// Model operations: one prompt per operation, built only from the representations in the preceding state.
import { callModel } from './model.js';

export const RETRY_STYLES = {
  shorter: 'Make it noticeably shorter and tighter — at most 50 words.',
  'more-poetic': 'Make it more poetic: imagery, rhythm, line breaks allowed.',
  'more-concrete': 'Make it more concrete: a specific everyday situation or action the reader could take.',
  'different-angle': 'Take a clearly different angle on the same material than the current remix.',
  'closer-to-my-words': "Stay much closer to the reader's own words and voice; keep their phrasing where possible.",
};

const quote = (h) => `"${h.text}"\n— ${h.author || 'Unknown'}, ${h.source}${h.location ? ` (${h.location})` : ''}`;

function validateKeywords(obj) {
  if (!Array.isArray(obj.keywords)) throw new Error('keywords missing');
  const kw = [...new Set(obj.keywords.map((k) => String(k).trim()).filter(Boolean))]
    .filter((k) => k.split(/\s+/).length <= 4 && k.length <= 40)
    .slice(0, 6);
  if (kw.length < 3) throw new Error('too few valid keywords');
  return kw;
}

function validateText(maxWords) {
  return (obj) => {
    const t = String(obj.text || '').trim();
    if (!t) throw new Error('empty text');
    if (t.split(/\s+/).length > maxWords) throw new Error('text too long');
    return t;
  };
}

/** P1.2 / P3.3 [model generate]~ : keywords for a highlight (optionally steered by an interest). */
export function generateKeywords(highlight, interest) {
  const prompt = `You help a reader reflect on a passage they once highlighted.

Passage:
${quote(highlight)}
${interest ? `\nThe reader is currently interested in: "${interest}"\nChoose keywords that connect the passage to this interest.\n` : ''}
Give 3 to 6 short keywords or key phrases (1-4 words each) naming the ideas, themes or tensions in the passage that the reader could respond to. Do not repeat the passage verbatim.

Reply with ONLY a JSON object: {"keywords": ["...", "..."]}`;
  return callModel(prompt, validateKeywords);
}

/** P1.4 [model compose]~ : remix = highlight + response (+keywords) woven into a new short piece. */
export function composeRemix(highlight, keywords, response) {
  const prompt = `A reader highlighted a passage and wrote a response to it. Compose a "remix": a short new piece (60-120 words) that weaves the passage's idea together with the reader's response, written in the reader's voice (first person), so that it reads as their own note-to-self that carries the idea forward. Do not quote the whole passage; you may echo a phrase. Do not add a title.

Passage:
${quote(highlight)}

Keywords the reader saw: ${keywords.join(', ')}

Reader's response:
"""${response}"""

Reply with ONLY a JSON object: {"text": "..."}`;
  return callModel(prompt, validateText(180));
}

/** P2.2 [model compose]~ : alternative remix in the requested retry style. */
export function composeAlternative(highlight, response, remix, retry) {
  const style = RETRY_STYLES[retry];
  if (!style) throw new Error(`Unknown retry style: ${retry}`);
  const prompt = `A reader highlighted a passage, wrote a response, and got a "remix" (a short first-person piece weaving both together). They asked for an alternative remix.

Requested change: ${style}

Passage:
${quote(highlight)}

Reader's response:
"""${response}"""

Current remix:
"""${remix}"""

Write the alternative remix in the reader's first-person voice. No title.
Reply with ONLY a JSON object: {"text": "..."}`;
  return callModel(prompt, validateText(180));
}
