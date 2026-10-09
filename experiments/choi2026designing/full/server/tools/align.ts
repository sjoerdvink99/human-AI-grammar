// tool_3 match — sequence alignment of the predicted transcript to the actual lyrics.
// lyrics + predicted_transcript -> timed_lyrics
//
// A Needleman–Wunsch-style dynamic programme over (transcript word, lyric token)
// extended with "jumps" from the end of any lyric line to the start of any line,
// so repeated choruses (sung several times but written once) align correctly.
import type { PredictedTranscript, TimedLine, TimedLyrics, WordTiming } from "../types.ts";

export interface LyricLine {
  section: string;
  text: string;
  words: string[]; // original spelling
  norm: string[];
}

export function parseLyrics(lyrics: string): LyricLine[] {
  const lines: LyricLine[] = [];
  let section = "Verse";
  for (const raw of lyrics.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const header = line.match(/^\[([^\]]+)\]$/);
    if (header) {
      section = header[1];
      continue;
    }
    const words = line.split(/\s+/).filter((w) => normToken(w));
    lines.push({ section, text: line, words, norm: words.map(normToken) });
  }
  return lines;
}

export function normToken(w: string): string {
  return w.toLowerCase().replace(/[^a-z0-9']/g, "").replace(/^'+|'+$/g, "");
}

function levenshtein(a: string, b: string) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

/** +2 exact, +1 close spelling, -1 mismatch */
function similarity(a: string, b: string): number {
  if (a === b) return 2;
  const d = levenshtein(a, b);
  if (d / Math.max(a.length, b.length, 1) <= 0.34) return 1;
  return -1;
}

const GAP = -1;
const JUMP = -0.5;

export function alignLyrics(lyrics: string, transcript: PredictedTranscript): TimedLyrics {
  const lines = parseLyrics(lyrics);
  const tokens: { line: number; idx: number; norm: string }[] = [];
  const lineStart: number[] = [];
  lines.forEach((l, li) => {
    lineStart.push(tokens.length);
    l.norm.forEach((n, idx) => tokens.push({ line: li, idx, norm: n }));
  });
  const lineEnds = new Set(lines.map((_, li) => (li + 1 < lines.length ? lineStart[li + 1] : tokens.length)));
  const T = transcript.words.length;
  const L = tokens.length;
  const tw = transcript.words.map((w) => normToken(w.word));

  const D: Float64Array[] = [];
  const BP: Uint8Array[] = []; // 1 diag, 2 insertion, 3 deletion, 4 jump
  const JS: Int32Array[] = [];
  for (let i = 0; i <= T; i++) {
    const row = new Float64Array(L + 1).fill(-Infinity);
    const bp = new Uint8Array(L + 1);
    const js = new Int32Array(L + 1).fill(-1);
    if (i === 0) row[0] = 0;
    else {
      const prev = D[i - 1];
      for (let j = 0; j <= L; j++) {
        if (prev[j] + GAP > row[j]) { row[j] = prev[j] + GAP; bp[j] = 2; }
        if (j > 0 && prev[j - 1] + similarity(tw[i - 1], tokens[j - 1].norm) > row[j]) {
          row[j] = prev[j - 1] + similarity(tw[i - 1], tokens[j - 1].norm);
          bp[j] = 1;
        }
      }
    }
    const delPass = () => {
      for (let j = 1; j <= L; j++) if (row[j - 1] + GAP > row[j]) { row[j] = row[j - 1] + GAP; bp[j] = 3; js[j] = -1; }
    };
    delPass();
    let bestEnd = -1;
    for (const e of lineEnds) if (bestEnd < 0 || row[e] > row[bestEnd]) bestEnd = e;
    if (bestEnd >= 0) {
      for (const s of lineStart) {
        if (s !== bestEnd && row[bestEnd] + JUMP > row[s]) { row[s] = row[bestEnd] + JUMP; bp[s] = 4; js[s] = bestEnd; }
      }
    }
    delPass();
    D.push(row); BP.push(bp); JS.push(js);
  }

  // backtrack
  let j = 0;
  for (let k = 1; k <= L; k++) if (D[T][k] > D[T][j]) j = k;
  let i = T;
  const events: ({ type: "match"; t: number; tok: number; sim: number } | { type: "jump" })[] = [];
  while (i > 0 || j > 0) {
    const b = BP[i][j];
    if (b === 1) { events.push({ type: "match", t: i - 1, tok: j - 1, sim: similarity(tw[i - 1], tokens[j - 1].norm) }); i--; j--; }
    else if (b === 2) i--;
    else if (b === 3) j--;
    else if (b === 4) { events.push({ type: "jump" }); j = JS[i][j]; }
    else break;
  }
  events.reverse();

  // group matches into line occurrences
  type Occ = { line: number; timings: Map<number, { w: WordTiming; matched: boolean }> };
  const occs: Occ[] = [];
  let cur: Occ | null = null;
  let lastIdx = -1;
  for (const ev of events) {
    if (ev.type === "jump") { cur = null; continue; }
    const tok = tokens[ev.tok];
    if (!cur || cur.line !== tok.line || tok.idx <= lastIdx) {
      cur = { line: tok.line, timings: new Map() };
      occs.push(cur);
    }
    cur.timings.set(tok.idx, { w: transcript.words[ev.t], matched: ev.sim > 0 });
    lastIdx = tok.idx;
  }

  let matched = 0, total = 0;
  const out: TimedLine[] = occs.map((o) => {
    const line = lines[o.line];
    const known = [...o.timings.entries()].sort((a, b) => a[0] - b[0]);
    const words = line.words.map((word, idx) => {
      const hit = o.timings.get(idx);
      total++;
      if (hit) {
        if (hit.matched) matched++;
        return { word, start: hit.w.start, end: hit.w.end, matched: hit.matched };
      }
      // interpolate between nearest known neighbours in this occurrence
      const before = [...known].reverse().find(([k]) => k < idx);
      const after = known.find(([k]) => k > idx);
      let start: number;
      let end: number;
      if (before && after) {
        const slot = Math.max(0.05, (after[1].w.start - before[1].w.end) / (after[0] - before[0] - 1));
        start = before[1].w.end + slot * (idx - before[0] - 1);
        end = start + slot;
      } else if (before) {
        start = before[1].w.end + 0.3 * (idx - before[0] - 1);
        end = start + 0.3;
      } else {
        start = after![1].w.start - 0.3 * (after![0] - idx);
        end = start + 0.3;
      }
      return { word, start: +Math.max(0, start).toFixed(3), end: +Math.max(0, end).toFixed(3), matched: false };
    });
    return { section: line.section, text: line.text, start: words[0].start, end: words[words.length - 1].end, words };
  });
  out.sort((a, b) => a.start - b.start);
  return { lines: out, matchRate: total ? +(matched / total).toFixed(3) : 0 };
}
