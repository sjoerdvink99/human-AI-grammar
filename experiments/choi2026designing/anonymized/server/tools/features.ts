import type { ProsodyFrame, WordFeatureRow, WordTiming } from "../../shared/types.ts";

/** P3/P5 [tool_4 extract]: r18 word timings + r17 prosody → r19 per-word feature table. */
export function buildWordFeatures(timings: WordTiming[], prosody: ProsodyFrame[]): WordFeatureRow[] {
  return timings.map((w, i) => {
    const frames = prosody.filter((f) => f.t >= w.start && f.t <= w.end);
    const pitches = frames.map((f) => f.pitchHz).filter((p): p is number => p !== null).sort((a, b) => a - b);
    const loud = frames.length ? frames.reduce((s, f) => s + f.rmsDb, 0) / frames.length : -80;
    const next = timings[i + 1];
    return {
      index: i + 1,
      word: w.word,
      start: w.start,
      end: w.end,
      duration: +(w.end - w.start).toFixed(3),
      pitchHz: pitches.length ? +pitches[Math.floor(pitches.length / 2)].toFixed(0) : null,
      loudnessDb: +loud.toFixed(1),
      pauseAfter: next ? +Math.max(0, next.start - w.end).toFixed(3) : 0,
    };
  });
}
