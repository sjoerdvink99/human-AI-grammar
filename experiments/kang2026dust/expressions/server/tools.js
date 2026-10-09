// Deterministic tool steps.

/** P1.1 [tool select]: resurface the least-recently-surfaced highlight (random among ties). */
export function selectHighlight(highlights, { excludeId, rand = Math.random } = {}) {
  const pool = highlights.filter((h) => h.id !== excludeId);
  const list = pool.length ? pool : highlights;
  if (!list.length) return null;
  const key = (h) => h.lastSurfacedAt || '';
  const oldest = list.reduce((m, h) => (key(h) < m ? key(h) : m), key(list[0]));
  const ties = list.filter((h) => key(h) === oldest);
  return ties[Math.floor(rand() * ties.length)];
}

const STOP = new Set(
  'a an and are as at be but by for from has have i in is it its me my of on or our so that the their them they this to was we what when which who will with you your about into not just more most than then there these those can could would should do does did how why all any some very'.split(
    ' '
  )
);

export function tokens(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, ' ')
    .split(/\s+/)
    .map((t) => t.replace(/'s$|'/g, ''))
    .filter((t) => t.length > 2 && !STOP.has(t))
    .map(stem);
}

function stem(t) {
  return t.replace(/(ings|ing|edly|ed|ly|es|s)$/, '').replace(/e$/, '') || t;
}

/**
 * P3.2 [tool select]: pick the highlight that best matches the interest.
 * Score = sum over interest terms of idf(term) if the term occurs in the highlight (text, source, author, keywords).
 * `excludeId` = highlight of the current remix, so the interest leads somewhere new.
 */
export function selectByInterest(highlights, interest, { excludeId } = {}) {
  const terms = [...new Set(tokens(interest))];
  const docs = highlights.map((h) => ({
    h,
    set: new Set(tokens([h.text, h.source, h.author, (h.keywords || []).join(' ')].join(' '))),
  }));
  const n = docs.length;
  const idf = (t) => Math.log(1 + n / (1 + docs.filter((d) => d.set.has(t)).length));
  let best = null;
  for (const d of docs) {
    if (d.h.id === excludeId && docs.length > 1) continue;
    const score = terms.reduce((s, t) => s + (d.set.has(t) ? idf(t) : 0), 0);
    if (!best || score > best.score) best = { h: d.h, score };
  }
  if (!best) return { highlight: null, score: 0 };
  if (best.score === 0) {
    // nothing matched: fall back to resurfacing so the user still gets something
    return { highlight: selectHighlight(highlights, { excludeId }), score: 0 };
  }
  return { highlight: best.h, score: best.score };
}

export const ALL_SOURCES = 'All sources';

/** P4 archive_filter values: a fixed set derived from the collection. */
export function filterOptions(highlights) {
  return [ALL_SOURCES, ...[...new Set(highlights.map((h) => h.source))].sort()];
}

/** P4.2 [tool select]: filter the collection by the chosen source. */
export function filterHighlights(highlights, filter) {
  if (!filter || filter === ALL_SOURCES) return highlights;
  return highlights.filter((h) => h.source === filter);
}
