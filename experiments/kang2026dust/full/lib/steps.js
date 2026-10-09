// Transformations of the design, one function per step.
import { callModel, callModelJson } from './model.js';

// ---------- time: "each Monday" ----------
const DAY = 86_400_000;

/** ISO date (YYYY-MM-DD) of the Monday of the week containing `date`, in local time. */
export function mondayOf(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dow = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - dow);
  return isoDate(d);
}
function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function addWeeks(mondayIso, n) {
  const [y, m, d] = mondayIso.split('-').map(Number);
  return isoDate(new Date(y, m - 1, d + 7 * n));
}
export function today(store) { return new Date(Date.now() + (store.data.dayOffset || 0) * DAY); }
export function currentWeekKey(store) { return mondayOf(today(store)); }

// ---------- [tool select]: random highlight ----------
/**
 * Pick a random highlight, preferring ones that have never been resurfaced.
 * @param {import('./highlights.js').Highlight[]} highlights
 * @param {Set<string>} exclude ids to avoid (already used / reserved)
 * @param {() => number} [rand]
 */
export function selectHighlight(highlights, exclude, rand = Math.random) {
  if (!highlights.length) return null;
  let pool = highlights.filter((h) => !exclude.has(h.id));
  if (!pool.length) pool = highlights; // everything shown once: start over
  return pool[Math.floor(rand() * pool.length)];
}

// ---------- [model generate]~: keywords ----------
const words = (s) => s.toLowerCase().match(/[\p{L}\p{N}']+/gu) || [];

/** A keyword "shows" the highlight if it copies 4+ consecutive words of it. */
function revealsQuote(keyword, text) {
  const k = words(keyword);
  if (k.length < 4) return false;
  return ` ${words(text).join(' ')} `.includes(` ${k.join(' ')} `);
}

/** Validate interest_1: a single word. */
export function normalizeInterest(raw) {
  const w = String(raw || '').trim().replace(/^["'“”]+|["'“”.,!?]+$/g, '');
  if (!w) return null;
  if (!/^[\p{L}\p{N}'-]{1,30}$/u.test(w)) throw new Error('Interest must be a single word (letters, digits, hyphen).');
  return w.toLowerCase();
}

/**
 * Enforce keywords: exactly three short hints, distinct, not quoting the highlight,
 * and (process 3) containing the interest word.
 */
export function validateKeywords(list, highlight, interest = null) {
  if (!Array.isArray(list)) throw new Error('keywords must be a list');
  let kws = [];
  for (const raw of list) {
    const k = String(raw).trim().replace(/^["'#*\-\s]+|["'.\s]+$/g, '').toLowerCase();
    if (!k || k.length > 30 || k.split(/\s+/).length > 3) continue;
    if (revealsQuote(k, highlight.text)) continue;
    if (!kws.includes(k)) kws.push(k);
  }
  if (interest) {
    kws = kws.filter((k) => k !== interest);
    kws = [interest, ...kws];
  }
  kws = kws.slice(0, 3);
  if (kws.length !== 3) throw new Error(`Expected 3 valid keywords, got ${kws.length}`);
  return interest ? [kws[1], kws[0], kws[2]] : kws; // interest word in the middle, not always first
}

export function keywordPrompt(highlight, interest) {
  return [
    'You help a reader rediscover a passage they once highlighted in an e-book.',
    'Give exactly THREE keywords that hint at the passage\'s ideas, mood or imagery WITHOUT revealing it:',
    '- each keyword is one word (at most two), lowercase',
    '- do not copy distinctive phrases from the passage; do not name the book or author',
    '- together they should invite a personal reflection',
    interest ? `- one of the three keywords MUST be exactly "${interest}" (the reader's current interest); choose the other two so they connect that interest to the passage` : '',
    '',
    `Passage (hidden from the reader): """${highlight.text}"""`,
    `Book: ${highlight.book}${highlight.author ? ` by ${highlight.author}` : ''}`,
    '',
    'Reply with JSON only: {"keywords": ["...", "...", "..."]}',
  ].filter((l) => l !== '').join('\n');
}

/** [model generate]~ (highlight) -> (keywords)*; optional interest for process 3. */
export async function generateKeywords(highlight, interest = null, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const out = await callModelJson(keywordPrompt(highlight, interest));
      return validateKeywords(out.keywords, highlight, interest);
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

// ---------- [model compose]~: remix ----------
export function remixPrompt(highlight, keywords, response, previous = null) {
  return [
    'You write "remixes": short new texts that weave together a reader\'s own reflection with a passage they once highlighted.',
    'The reader saw only three keywords, wrote a reflection on them, and will now see the original passage beside your remix.',
    'Write ONE remix that:',
    '- blends the reader\'s reflection and the passage into a single new piece of prose (or a prose-poem), 60-140 words',
    '- keeps the reader\'s voice (first person if they wrote in first person) and echoes at least one phrase from the passage',
    '- reveals a connection between their thought and the passage they may not have noticed',
    '- has no title, no preamble, no quotation marks around the whole text, no commentary',
    previous ? `- is clearly DIFFERENT from this earlier remix in angle, form and wording:\n"""${previous}"""` : '',
    '',
    `Keywords shown to the reader: ${keywords.join(', ')}`,
    `Reader's reflection: """${response}"""`,
    `Original passage: """${highlight.text}"""`,
    `Source: ${highlight.book}${highlight.author ? ` by ${highlight.author}` : ''}`,
    '',
    'Reply with the remix text only.',
  ].filter((l) => l !== '').join('\n');
}

export function validateRemix(text, previous = null) {
  let t = String(text || '').trim().replace(/^```\w*\n?|```$/g, '').trim();
  t = t.replace(/^(remix|here is[^:]*):\s*/i, '').replace(/^"([\s\S]*)"$/, '$1').trim();
  if (t.length < 20) throw new Error('Remix too short');
  if (t.length > 2000) t = t.slice(0, 2000);
  if (previous && t === previous.trim()) throw new Error('Alternative remix identical to the first');
  return t;
}

/** [model compose]~ (highlight + keywords + response) -> (remix); with `previous` it yields alternative_remix. */
export async function composeRemix(highlight, keywords, response, previous = null, attempts = 2) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return validateRemix(await callModel(remixPrompt(highlight, keywords, response, previous)), previous);
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

export function validateResponse(raw) {
  const r = String(raw || '').trim();
  if (r.length < 3) throw new Error('Write a few words of reflection first.');
  if (r.length > 3000) throw new Error('Keep the reflection short (under 3000 characters).');
  return r;
}

// ---------- [tool select]: archive filter ----------
/**
 * @param {'all'|'remixed'} filter archive_filter_1
 * @returns filtered_highlights_1 with their weekly entries (only past/current weeks)
 */
export function filterArchive(store, filter = 'all') {
  const now = currentWeekKey(store);
  const visibleWeeks = store.data.weeks.filter((w) => w.week <= now);
  return store.data.highlights.map((h) => {
    const weeks = visibleWeeks.filter((w) => w.highlightId === h.id).sort((a, b) => b.week.localeCompare(a.week));
    const remixed = weeks.some((w) => w.remix);
    // keep the current week's quote hidden until its remix reveals it
    const hidden = weeks.some((w) => w.week === now && !w.remix) && !weeks.some((w) => w.week < now);
    return { ...h, text: hidden ? null : h.text, hidden, weeks, remixed };
  }).filter((h) => (filter === 'remixed' ? h.remixed : true))
    .sort((a, b) => (b.weeks[0]?.week || '').localeCompare(a.weeks[0]?.week || '') || a.book.localeCompare(b.book));
}
