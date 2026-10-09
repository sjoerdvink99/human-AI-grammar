/** tool_3 match: lyrics + predicted_transcript → timed_lyrics (word-level global alignment). */
import type { PredictedTranscript, TimedLyrics } from '../types.ts';

const norm = (w: string) => w.toLowerCase().replace(/[^a-z0-9']/g, '');

export function parseLyricLines(lyrics: string): { line: string; section: string }[] {
  let section = '';
  const out: { line: string; section: string }[] = [];
  for (const raw of lyrics.split('\n')) {
    const l = raw.trim();
    if (!l) continue;
    const h = l.match(/^\[(.+)\]$/);
    if (h) { section = h[1]; continue; }
    out.push({ line: l, section });
  }
  return out;
}

export function alignLyrics(lyrics: string, transcript: PredictedTranscript): TimedLyrics {
  const lines = parseLyricLines(lyrics);
  const A = lines.flatMap((l, li) => l.line.split(/\s+/).map(norm).filter(Boolean).map((w) => ({ w, li })));
  const B = transcript.segments.flatMap((s) => s.words).map((x) => ({ ...x, w: norm(x.word) }));
  const n = A.length, m = B.length;
  const GAP = -1, MATCH = 2, MIS = -1;
  const S = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
  for (let i = 1; i <= n; i++) S[i][0] = i * GAP;
  for (let j = 1; j <= m; j++) S[0][j] = 0; // free leading transcript (intro, repeats)
  for (let i = 1; i <= n; i++)
    for (let j = 1; j <= m; j++)
      S[i][j] = Math.max(S[i - 1][j - 1] + (A[i - 1].w === B[j - 1].w ? MATCH : MIS), S[i - 1][j] + GAP, S[i][j - 1] + GAP);
  // free trailing transcript: start traceback from best cell in last row
  let j = 0;
  for (let k = 0; k <= m; k++) if (S[n][k] > S[n][j]) j = k;
  let i = n;
  const match: (number | null)[] = new Array(n).fill(null);
  while (i > 0 && j > 0) {
    if (S[i][j] === S[i - 1][j - 1] + (A[i - 1].w === B[j - 1].w ? MATCH : MIS)) {
      if (A[i - 1].w === B[j - 1].w) match[i - 1] = j - 1;
      i--; j--;
    } else if (S[i][j] === S[i - 1][j] + GAP) i--;
    else j--;
  }
  return {
    lines: lines.map((l, li) => {
      const idx = A.map((a, k) => (a.li === li ? k : -1)).filter((k) => k >= 0);
      const hits = idx.map((k) => match[k]).filter((x): x is number => x !== null);
      return {
        ...l,
        start: hits.length ? B[Math.min(...hits)].start : null,
        end: hits.length ? B[Math.max(...hits)].end : null,
        match_score: idx.length ? +(hits.length / idx.length).toFixed(2) : 0,
      };
    }),
  };
}
