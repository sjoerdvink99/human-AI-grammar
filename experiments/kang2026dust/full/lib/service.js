// Application service: wires the design's processes onto the store.
import { parseHighlights } from './highlights.js';
import {
  addWeeks, composeRemix, currentWeekKey, filterArchive, generateKeywords, normalizeInterest,
  selectHighlight, today, validateResponse,
} from './steps.js';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export class Service {
  /** @param {import('./store.js').Store} store */
  constructor(store) {
    this.store = store;
    this.inflight = new Map(); // de-duplicate concurrent model calls per key
  }

  once(key, fn) {
    if (!this.inflight.has(key)) {
      const p = fn().finally(() => this.inflight.delete(key));
      this.inflight.set(key, p);
    }
    return this.inflight.get(key);
  }

  usedIds(exceptWeek = null) {
    return new Set(this.store.data.weeks.filter((w) => w.week !== exceptWeek).map((w) => w.highlightId));
  }

  /** Public view of a week: the quote and its source stay hidden until the remix exists. */
  publicWeek(w) {
    if (!w) return null;
    const h = this.store.highlight(w.highlightId);
    const revealed = Boolean(w.remix);
    return {
      week: w.week,
      keywords: w.keywords,
      keywordError: w.keywordError || null,
      interest: w.interest,
      response: w.response,
      remix: w.remix,
      alternativeRemix: w.alternativeRemix,
      retryUsed: w.retryUsed,
      highlight: revealed && h ? h : null,
    };
  }

  // ----- library -----
  upload(content, filename, defaults) {
    const parsed = parseHighlights(String(content || ''), filename, defaults);
    if (!parsed.length) throw new HttpError(400, 'No highlights found in that file.');
    const seen = new Set(this.store.data.highlights.map((h) => h.text.toLowerCase()));
    const fresh = parsed.filter((h) => !seen.has(h.text.toLowerCase()) && seen.add(h.text.toLowerCase()));
    this.store.data.highlights.push(...fresh);
    this.store.save();
    return { added: fresh.length, skipped: parsed.length - fresh.length, total: this.store.data.highlights.length };
  }

  library() {
    return this.store.data.highlights.map(({ id, book, author }) => ({ id, book, author }));
  }

  // ----- process 1: weekly trigger -----
  /** On the first visit of a new Monday-week: [tool select] then [model generate]~ keywords. */
  async ensureCurrentWeek() {
    const key = currentWeekKey(this.store);
    const { highlights } = this.store.data;
    if (!highlights.length) return null;
    let w = this.store.week(key);
    if (!w) {
      const h = selectHighlight(highlights, this.usedIds()); // [tool select] -> highlight_1
      w = {
        week: key, highlightId: h.id, keywords: [], interest: null, response: null,
        remix: null, alternativeRemix: null, retryUsed: false, createdAt: new Date().toISOString(),
      };
      this.store.data.weeks.push(w);
      this.store.save();
    }
    if (w.keywords.length !== 3) await this.fillKeywords(w);
    return w;
  }

  async fillKeywords(w) {
    await this.once(`kw:${w.week}`, async () => {
      try {
        w.keywords = await generateKeywords(this.store.highlight(w.highlightId), w.interest); // [model generate]~
        delete w.keywordError;
      } catch (e) {
        w.keywordError = e.message;
      }
      this.store.save();
    });
  }

  async state() {
    const w = await this.ensureCurrentWeek();
    const key = currentWeekKey(this.store);
    const next = this.store.week(addWeeks(key, 1));
    return {
      today: today(this.store).toISOString(),
      weekKey: key,
      highlightCount: this.store.data.highlights.length,
      week: this.publicWeek(w),
      nextWeek: next ? { week: next.week, interest: next.interest, ready: next.keywords.length === 3 } : null,
    };
  }

  currentOrThrow() {
    const w = this.store.week(currentWeekKey(this.store));
    if (!w || w.keywords.length !== 3) throw new HttpError(409, 'This week\'s keywords are not ready yet.');
    return w;
  }

  /** [human generate] response_1 -> [model compose]~ remix_1 (reveals quote and source). */
  async respond(rawResponse) {
    const w = this.currentOrThrow();
    if (w.remix) throw new HttpError(409, 'This week already has a remix.');
    w.response = validateResponse(rawResponse);
    this.store.save();
    await this.once(`remix:${w.week}`, async () => {
      if (w.remix) return;
      w.remix = await composeRemix(this.store.highlight(w.highlightId), w.keywords, w.response);
      this.store.save();
    });
    return this.publicWeek(w);
  }

  // ----- process 2 -----
  /** [human specify] retry_1 (once) -> [model compose]~ alternative_remix_1. */
  async retry() {
    const w = this.currentOrThrow();
    if (!w.remix) throw new HttpError(409, 'Write a reflection first.');
    if (w.retryUsed) throw new HttpError(409, 'You can try again only once per week.');
    await this.once(`alt:${w.week}`, async () => {
      if (w.retryUsed) return;
      w.alternativeRemix = await composeRemix(this.store.highlight(w.highlightId), w.keywords, w.response, w.remix);
      w.retryUsed = true;
      this.store.save();
    });
    return this.publicWeek(w);
  }

  // ----- process 3 -----
  /** [human specify] interest_1 -> [tool select] highlight_2 -> [model generate]~ keywords_2 (next Monday). */
  async setInterest(raw) {
    const cur = this.currentOrThrow();
    if (!cur.remix) throw new HttpError(409, 'Finish this week\'s reflection first.');
    let interest;
    try { interest = normalizeInterest(raw); } catch (e) { throw new HttpError(400, e.message); }
    if (!interest) throw new HttpError(400, 'Enter a word.');
    const nextKey = addWeeks(cur.week, 1);
    const existing = this.store.week(nextKey);
    if (existing?.response) throw new HttpError(409, 'Next week has already started.');
    const exclude = this.usedIds(nextKey);
    const h = selectHighlight(this.store.data.highlights, exclude); // [tool select] -> highlight_2
    const w = {
      week: nextKey, highlightId: h.id, keywords: [], interest, response: null, remix: null,
      alternativeRemix: null, retryUsed: false, createdAt: new Date().toISOString(),
    };
    this.store.data.weeks = this.store.data.weeks.filter((x) => x.week !== nextKey);
    this.store.data.weeks.push(w);
    this.store.save();
    await this.fillKeywords(w); // keywords_2 stay hidden until next Monday
    return { week: nextKey, interest, ready: w.keywords.length === 3, error: w.keywordError || null };
  }

  // ----- process 4 -----
  archive(filter) {
    if (!['all', 'remixed'].includes(filter)) throw new HttpError(400, 'Unknown filter');
    return filterArchive(this.store, filter); // [tool select] -> filtered_highlights_1
  }

  // ----- demo clock -----
  advanceToNextMonday() {
    const d = today(this.store);
    const daysToMonday = ((8 - d.getDay()) % 7) || 7;
    this.store.data.dayOffset = (this.store.data.dayOffset || 0) + daysToMonday;
    this.store.save();
  }
  resetClock() { this.store.data.dayOffset = 0; this.store.save(); }
}
