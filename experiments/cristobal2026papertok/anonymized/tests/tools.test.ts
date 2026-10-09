import { describe, it, expect } from "vitest";
import { wavDuration, extractMetadata, composeTitleImage, composeClarifyPrompt } from "../server/tools.ts";
import { sanitizeSVG, extractJSON } from "../server/provider.ts";
import { composeClip, mapLimit } from "../server/pipeline.ts";

function wav(seconds: number, rate = 22050) {
  const data = Math.round(seconds * rate * 2);
  const b = Buffer.alloc(44 + data);
  b.write("RIFF", 0); b.writeUInt32LE(36 + data, 4); b.write("WAVE", 8);
  b.write("fmt ", 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write("data", 36); b.writeUInt32LE(data, 40);
  return b;
}

describe("tools", () => {
  it("measures WAV duration", () => expect(wavDuration(wav(2.5))).toBeCloseTo(2.5, 2));
  it("extracts paper metadata", () => {
    const m = extractMetadata("Attention Is All You Need\nAshish Vaswani, Noam Shazeer, and Niki Parmar\nNeurIPS 2017\nAbstract\nThe dominant ...");
    expect(m[0]).toBe("Attention Is All You Need");
    expect(m[1]).toContain("Vaswani");
    expect(m).toContain("2017");
  });
  it("composes an escaped title card", () => {
    const svg = composeTitleImage(null, "A <b> & c\nauthors");
    expect(svg).toContain("&lt;b&gt; &amp; c");
    expect(svg.startsWith("<svg")).toBe(true);
  });
  it("composes clarify prompt", () => {
    const p = composeClarifyPrompt({ title: "T", audience: "a", hook: "h", tone: "t", keyMessage: "k", outline: ["x", "y"], targetSeconds: 60 });
    expect(p).toContain("1. x");
  });
});

describe("provider helpers", () => {
  it("sanitizes svg", () => {
    const s = sanitizeSVG('blah <svg viewBox="0 0 10 10" onload="x()"><script>evil()</script><image href="http://x/y.png"/><use href="#a"/></svg> trailing');
    expect(s).not.toContain("script");
    expect(s).not.toContain("onload");
    expect(s).not.toContain("http://x");
    expect(s).toContain('href="#a"');
    expect(s).toContain('width="1280"');
  });
  it("extracts fenced JSON", () => expect(extractJSON('Sure!\n```json\n{"a":[1]}\n```')).toEqual({ a: [1] }));
});

describe("pipeline helpers", () => {
  it("keeps the previous clip in history", () => {
    const base = { id: "1", text: "a", visualPrompt: "p", voice: "v", audio: "/m/a.wav", duration: 1, image: "/m/a.svg", at: "t", history: [] };
    const next = composeClip(base, { text: "b", visualPrompt: "p", voice: "v", audio: "/m/b.wav", duration: 2, image: "/m/b.svg" });
    expect(next.text).toBe("b");
    expect(next.history).toHaveLength(1);
    expect(next.history[0].text).toBe("a");
  });
  it("mapLimit preserves order", async () => expect(await mapLimit([3, 1, 2], 2, async (x) => x * 2)).toEqual([6, 2, 4]));
});
