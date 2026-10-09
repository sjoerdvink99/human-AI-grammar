import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { checkBrief } from "../server/tools/briefCheck.ts";
import { analyzeAudio, estimatePitch } from "../server/tools/audioAnalysis.ts";
import { alignWords, phrases, tokenize } from "../server/tools/align.ts";
import { buildWordFeatures } from "../server/tools/features.ts";
import { renderProsodyChart } from "../server/tools/chart.ts";
import { sanitizeMarkup, spokenWords } from "../server/model/speech.ts";
import { parseLooseJson } from "../server/model/provider.ts";
import { DEFAULT_TEMPLATE } from "../server/defaults.ts";

describe("tool_1 checkBrief", () => {
  it("is incomplete while required fields are missing", () => {
    const s = checkBrief(DEFAULT_TEMPLATE, { occasion: "wedding", audience: null });
    expect(s.status).toBe("incomplete");
    expect(s.missing).toContain("audience");
    expect(s.missing).not.toContain("tone"); // optional
  });
  it("is complete when all required fields are present", () => {
    const b = Object.fromEntries(DEFAULT_TEMPLATE.map((f) => [f.key, f.required ? "x" : null]));
    expect(checkBrief(DEFAULT_TEMPLATE, b)).toEqual({ status: "complete", missing: [] });
  });
});

describe("pitch estimation", () => {
  it("finds the frequency of a sine wave", () => {
    const sr = 22050;
    const win = new Float32Array(882).map((_, i) => Math.sin((2 * Math.PI * 150 * i) / sr));
    expect(estimatePitch(win, sr)).toBeGreaterThan(140);
    expect(estimatePitch(win, sr)).toBeLessThan(160);
  });
});

describe("alignment helpers", () => {
  it("splits phrases at punctuation", () => {
    const w = tokenize("Hello there, friends. How are you?");
    expect(phrases(w)).toEqual([[0, 2], [2, 3], [3, 6]]);
  });
  it("aligns words monotonically inside the segments", () => {
    const t = alignWords("One two, three four.", [{ start: 0.1, end: 0.6 }, { start: 0.9, end: 1.5 }], 1.6);
    expect(t.map((w) => w.word)).toEqual(["One", "two,", "three", "four."]);
    expect(t[1].end).toBeLessThanOrEqual(0.6 + 1e-6);
    expect(t[2].start).toBeGreaterThanOrEqual(0.9 - 1e-6);
    for (let i = 1; i < t.length; i++) expect(t[i].start).toBeGreaterThanOrEqual(t[i - 1].end - 1e-6);
  });
});

describe("speech markup validation", () => {
  it("strips unknown commands and compares words", () => {
    const m = sanitizeMarkup("Hello [[slnc 300]] [[emph +]]world [[inpt PHON]]!");
    expect(m).not.toContain("inpt");
    expect(spokenWords(m)).toEqual(spokenWords("Hello, world!"));
  });
  it("parses JSON from loose model text", () => {
    expect(parseLooseJson('Sure:\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
});

describe("tool_2..tool_5 on real synthesized audio", () => {
  it("extracts segments, aligns words, builds features and a chart", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ss-"));
    const file = path.join(dir, "t.wav");
    const script = "Good evening, everyone. Thank you for coming tonight. [[slnc 600]] Let us begin.";
    try {
      execFileSync("say", ["-v", "Samantha", "-o", file, "--data-format=LEI16@22050", script]);
    } catch {
      return; // not on macOS
    }
    const plain = script.replace(/\[\[[^\]]*\]\]/g, "");
    const { duration, segments, prosody } = analyzeAudio(file);
    expect(duration).toBeGreaterThan(2);
    expect(segments.length).toBeGreaterThanOrEqual(2);
    expect(prosody.some((f) => f.pitchHz !== null)).toBe(true);
    const timings = alignWords(plain, segments, duration);
    expect(timings).toHaveLength(tokenize(plain).length);
    const rows = buildWordFeatures(timings, prosody);
    expect(rows.find((r) => r.word === "tonight.")!.pauseAfter).toBeGreaterThan(0.3);
    const svg = renderProsodyChart(rows, prosody, duration);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("evening,");
  });
});
