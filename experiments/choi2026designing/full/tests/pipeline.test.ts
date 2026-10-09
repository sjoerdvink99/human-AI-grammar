import { describe, expect, it } from "vitest";
import { renderScore } from "../server/music/synth.ts";
import type { Score } from "../server/music/score.ts";
import { assignWordsToSegments, computeAudioFeatures, detectVoicedSegments, normaliseForRecognition } from "../server/tools/analysis.ts";
import { alignLyrics } from "../server/tools/align.ts";
import { extractBeatsFromSamples } from "../server/tools/beats.ts";
import { evaluateStepStatus } from "../server/tools/stepChecker.ts";
import { THERAPY_FRAMEWORK } from "../server/framework.ts";
import { validateLyrics } from "../server/process2.ts";
import { renderVisualization } from "../server/tools/visualize.ts";

const LYRICS = `[Verse 1]
I felt the floor begin to shake
A rhythm only I could take
[Chorus]
Hold the light, hold it close
Feel the beat inside my bones
[Verse 2]
Hands that speak in silver air
Telling stories everywhere
[Bridge]
Quiet is not empty`;

const line = (text: string, degrees: number[]) => ({
  notes: text.split(" ").map((w, i) => ({ word: w.replace(/[^A-Za-z']/g, ""), degree: degrees[i % degrees.length], beats: 1 })),
});

const SCORE: Score = {
  bpm: 100,
  key: "A",
  mode: "minor",
  instruments: ["piano", "bass", "drums", "synth pad"],
  drumPattern: "pop",
  swing: false,
  vocalRegister: "high",
  vocalTone: "warm",
  arrangement: [
    { label: "Intro", energy: 0.4, chords: ["i", "VI"], lines: [] },
    { label: "Verse 1", energy: 0.5, chords: ["i", "VI", "III", "VII"], lines: [line("I felt the floor begin to shake", [1, 3, 5, 3, 2, 1, 2]), line("A rhythm only I could take", [5, 5, 4, 3, 2, 1])] },
    { label: "Chorus", energy: 0.8, chords: ["VI", "VII", "i"], lines: [line("Hold the light, hold it close", [5, 6, 8, 6, 5]), line("Feel the beat inside my bones", [5, 4, 3, 2, 1, 1])] },
    { label: "Verse 2", energy: 0.5, chords: ["i", "VI", "III", "VII"], lines: [line("Hands that speak in silver air", [1, 3, 5, 3, 2, 1]), line("Telling stories everywhere", [2, 3, 1, 1])] },
    { label: "Chorus", energy: 0.85, chords: ["VI", "VII", "i"], lines: [line("Hold the light, hold it close", [5, 6, 8, 6, 5]), line("Feel the beat inside my bones", [5, 4, 3, 2, 1, 1])] },
    { label: "Outro", energy: 0.3, chords: ["i"], lines: [] },
  ],
};

describe("music pipeline", () => {
  const r = renderScore(SCORE, 3);
  const segs = detectVoicedSegments(r.vocal, r.sampleRate);
  const sungText = SCORE.arrangement.flatMap((s) => s.lines.map((l) => l.notes.map((n) => n.word).join(" "))).join("\n");
  const words = assignWordsToSegments(normaliseForRecognition(sungText), segs);

  it("tool_2: detects one voiced segment per sung word with accurate onsets", () => {
    expect(segs.length).toBe(r.sung.length);
    words.forEach((w, i) => expect(Math.abs(w.start - r.sung[i].start)).toBeLessThan(0.05));
  });

  it("tool_2: estimates the key", () => {
    const f = computeAudioFeatures(r.mix, r.sampleRate);
    expect(["A minor", "C major"]).toContain(`${f.key} ${f.mode}`);
    expect(f.loudness.length).toBeGreaterThan(10);
  });

  it("tool_3: aligns repeated chorus and restores lyric spelling", () => {
    const timed = alignLyrics(LYRICS, { words });
    const choruses = timed.lines.filter((l) => l.text.startsWith("Hold the light"));
    expect(choruses.length).toBe(2);
    expect(choruses[0].words[2].word).toBe("light,");
    expect(timed.lines.find((l) => l.text === "Quiet is not empty")).toBeUndefined(); // not sung
    expect(timed.matchRate).toBeGreaterThan(0.9);
    for (let i = 1; i < timed.lines.length; i++) expect(timed.lines[i].start).toBeGreaterThanOrEqual(timed.lines[i - 1].start);
  });

  it("tool_3: tolerates recognition errors", () => {
    const noisy = words.map((w, i) => (i === 3 ? { ...w, word: "flor" } : i === 10 ? { ...w, word: "rythm" } : w)).filter((_, i) => i !== 5);
    const timed = alignLyrics(LYRICS, { words: noisy });
    const first = timed.lines[0];
    expect(first.text).toBe("I felt the floor begin to shake");
    expect(first.words[5].start).toBeGreaterThan(first.words[4].start);
  });

  it("tool_4: tracks the tempo and beats", () => {
    const b = extractBeatsFromSamples(r.mix, r.sampleRate);
    const ratio = b.tempo / SCORE.bpm;
    expect([0.5, 1, 2].some((k) => Math.abs(ratio - k) < 0.06)).toBe(true);
    expect(b.rows.length).toBeGreaterThan(20);
    expect(b.rows.filter((x) => x.downbeat).length).toBeGreaterThan(4);
  });

  it("tool_5: builds a visualization spec", () => {
    const f = computeAudioFeatures(r.mix, r.sampleRate);
    const b = extractBeatsFromSamples(r.mix, r.sampleRate);
    const v = renderVisualization(r.duration, alignLyrics(LYRICS, { words }), f, b);
    expect(v.lines.length).toBeGreaterThan(5);
    expect(v.summary.length).toBe(4);
  });
});

describe("tool_1 step checker", () => {
  it("advances only when a step's variables are filled", () => {
    const st = evaluateStepStatus(THERAPY_FRAMEWORK, { experience: "losing hearing at 12", context: "" }, 0, 1);
    expect(st.status).toBe("incomplete");
    expect(st.missing).toEqual(["context"]);
    const st2 = evaluateStepStatus(THERAPY_FRAMEWORK, { experience: "losing hearing at 12", context: "at school" }, 0, 1);
    expect(st2.status).toBe("complete");
    expect(st2.currentStep).toBe(1);
  });
  it("moves on after the maximum number of turns", () => {
    const st = evaluateStepStatus(THERAPY_FRAMEWORK, {}, 2, THERAPY_FRAMEWORK.maxTurnsPerStep);
    expect(st.currentStep).toBe(3);
  });
  it("reports completion of all steps", () => {
    const all = Object.fromEntries(THERAPY_FRAMEWORK.steps.flatMap((s) => s.variables.map((v) => [v.key, "something"])));
    expect(evaluateStepStatus(THERAPY_FRAMEWORK, all, 0, 0).allComplete).toBe(true);
  });
});

describe("lyrics validation", () => {
  it("requires verses, chorus and bridge", () => {
    expect(validateLyrics(LYRICS)).toMatch(/between 10 and 40/);
    expect(validateLyrics("[Verse 1]\na\n[Chorus]\nb")).toMatch(/two \[Verse\]/);
  });
});
