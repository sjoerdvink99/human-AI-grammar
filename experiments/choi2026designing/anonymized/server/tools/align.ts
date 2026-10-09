// P3/P5 [tool_3 match]: r10 script + r16 segments → r18 word timings.
//
// Without a speech recogniser, words are matched to the audio by duration: each word gets a share of the
// voiced time proportional to its length. Detected pauses are preferentially assigned to word boundaries that
// follow punctuation (where the synthesizer pauses), by dynamic programming over phrase/segment boundaries.
import type { Segment, WordTiming } from "../../shared/types.ts";

export function tokenize(script: string): string[] {
  return script.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w));
}

const weight = (w: string) => w.replace(/[^A-Za-z0-9]/g, "").length + 2;

/** Groups words into phrases ending at punctuation. Returns index ranges [from, to). */
export function phrases(words: string[]): [number, number][] {
  const out: [number, number][] = [];
  let from = 0;
  words.forEach((w, i) => {
    if (/[.,;:!?…—–)"”]$/.test(w) || i === words.length - 1) {
      out.push([from, i + 1]);
      from = i + 1;
    }
  });
  return out;
}

export function alignWords(script: string, segments: Segment[], duration: number): WordTiming[] {
  const words = tokenize(script);
  if (!words.length) return [];
  const segs = segments.length ? segments : [{ start: 0, end: duration }];
  const ph = phrases(words);
  const phWeight = ph.map(([a, b]) => words.slice(a, b).reduce((s, w) => s + weight(w), 0));
  const segLen = segs.map((s) => s.end - s.start);
  const totalW = phWeight.reduce((a, b) => a + b, 0);
  const totalT = segLen.reduce((a, b) => a + b, 0);

  // DP: assign consecutive phrase groups to consecutive segment groups (monotonic, both non-empty),
  // minimising squared error between expected and actual duration of each group.
  // Groups are formed by deciding, for each segment boundary, which phrase boundary it falls on.
  const P = ph.length;
  const S = segs.length;
  const prefW = [0];
  phWeight.forEach((w) => prefW.push(prefW[prefW.length - 1] + w));
  const prefT = [0];
  segLen.forEach((t) => prefT.push(prefT[prefT.length - 1] + t));
  // cost[i][j]: phrases [0,i) aligned to segments [0,j) with a boundary at both.
  const INF = Number.POSITIVE_INFINITY;
  const cost = Array.from({ length: P + 1 }, () => new Array<number>(S + 1).fill(INF));
  const back = Array.from({ length: P + 1 }, () => new Array<[number, number]>(S + 1).fill([0, 0]));
  cost[0][0] = 0;
  const MAXG = 6; // limit group sizes to keep it fast
  for (let i = 1; i <= P; i++)
    for (let j = 1; j <= S; j++)
      for (let pi = Math.max(0, i - MAXG); pi < i; pi++)
        for (let sj = Math.max(0, j - MAXG); sj < j; sj++) {
          if (cost[pi][sj] === INF) continue;
          // Prefer 1:1 groupings; merging costs a little.
          const exp = ((prefW[i] - prefW[pi]) / totalW) * totalT;
          const act = prefT[j] - prefT[sj];
          const c = cost[pi][sj] + (exp - act) ** 2 + 0.01 * (i - pi - 1 + (j - sj - 1));
          if (c < cost[i][j]) {
            cost[i][j] = c;
            back[i][j] = [pi, sj];
          }
        }

  const timings: WordTiming[] = new Array(words.length);
  const placeGroup = (pFrom: number, pTo: number, sFrom: number, sTo: number) => {
    // Lay the words of phrases [pFrom,pTo) over the voiced time of segments [sFrom,sTo).
    const wFrom = ph[pFrom][0];
    const wTo = ph[pTo - 1][1];
    const gw = words.slice(wFrom, wTo).reduce((s, w) => s + weight(w), 0);
    const gsegs = segs.slice(sFrom, sTo);
    const gT = gsegs.reduce((s, g) => s + g.end - g.start, 0);
    // Map cumulative voiced time → absolute time.
    const at = (v: number) => {
      for (const g of gsegs) {
        const len = g.end - g.start;
        if (v <= len + 1e-9) return g.start + v;
        v -= len;
      }
      return gsegs[gsegs.length - 1].end;
    };
    let acc = 0;
    for (let k = wFrom; k < wTo; k++) {
      const a = (acc / gw) * gT;
      acc += weight(words[k]);
      const b = (acc / gw) * gT;
      timings[k] = { word: words[k], start: +at(a).toFixed(3), end: +at(b - 1e-6).toFixed(3) };
    }
  };

  if (cost[P][S] < INF) {
    let i = P;
    let j = S;
    while (i > 0) {
      const [pi, sj] = back[i][j];
      placeGroup(pi, i, sj, j);
      i = pi;
      j = sj;
    }
  } else {
    placeGroup(0, P, 0, S); // more segments than the DP window allows: proportional fallback
  }
  return timings;
}
