import { describe, expect, it } from "vitest";
import { parseCsv } from "../src/tools/csv.ts";
import { profileData, describeProfile, aggregate } from "../src/tools/profile.ts";
import { parseConcepts } from "../src/tools/concepts.ts";
import { baseChartSvg } from "../src/tools/basechart.ts";
import { composeIllustrationPrompts, composeSteeredPrompt, composeVariantPrompts } from "../src/tools/compose.ts";
import { extractSvg, InvalidSvgError } from "../src/tools/sanitize.ts";
import { tagElements, cropSvg, prefixIds, unionBox } from "../src/tools/svg.ts";
import { cropSegments } from "../src/tools/crop.ts";
import { anchorsFromSegments, marksFromData, composeCharts } from "../src/tools/layout.ts";
import { matchRows } from "../src/tools/match.ts";
import { finalizeChart } from "../src/tools/finalize.ts";
import { sampleDataset } from "../src/sample.ts";
import { extractJson } from "../server/model.ts";
import type { ChartSpec, Variant } from "../src/types.ts";

const r1 = sampleDataset("fruit-harvest.csv");

describe("Process 1 tools", () => {
  it("parses CSV with quotes and numbers", () => {
    const d = parseCsv('name,value\n"Smith, J",1,\nB,2.5\n');
    expect(d.columns).toEqual(["name", "value"]);
    expect(d.rows[0]).toEqual({ name: "Smith, J", value: 1 });
    expect(d.rows[1].value).toBe(2.5);
  });

  it("profiles and describes (r1 -> r2 -> r3)", () => {
    const r2 = profileData(r1);
    expect(r2.rowCount).toBe(9);
    expect(r2.defaultCategory).toBe("fruit");
    expect(r2.defaultValue).toBe("tons");
    const r3 = describeProfile(r2, r1.name);
    expect(r3).toContain('"tons": numeric');
    expect(r3).toContain("Apple");
  });

  it("aggregates", () => {
    const g = aggregate(r1, "fruit", "tons", "sum");
    expect(g.find((x) => x.category === "Apple")!.value).toBe(72);
    expect(aggregate(r1, "fruit", "", "count").find((x) => x.category === "Orange")!.value).toBe(2);
  });

  it("extracts concepts from a brainstorm (r4 -> r5*)", () => {
    const r5 = parseConcepts("Here you go:\n1. **Orchard** — trees\n2) Market stall — crates\n- Basket — fruit\nthanks");
    expect(r5).toEqual(["Orchard — trees", "Market stall — crates", "Basket — fruit"]);
  });

  it("builds a base chart and composes prompts (r6, r7*, r10)", () => {
    const r6 = baseChartSvg(r1, profileData(r1));
    expect(r6.bars).toHaveLength(5);
    expect(r6.svg).toMatch(/^<svg/);
    const r7 = composeIllustrationPrompts(["A", "B", "C", "D", "E"], r6, 4);
    expect(r7).toHaveLength(4);
    expect(r7[0]).toContain("exactly 5");
    expect(composeSteeredPrompt("watercolour", ["A"], r6)).toContain("watercolour");
  });
});

describe("generative output validation", () => {
  it("extracts and sanitises SVG", () => {
    const s = extractSvg('Sure!\n```svg\n<svg width="10" height="20"><script>x()</script><rect onclick="x()" width="5" height="5"/></svg>\n```');
    expect(s).not.toContain("script");
    expect(s).not.toContain("onclick");
    expect(s).toContain('viewBox="0 0 10 20"');
    expect(s).toContain("xmlns");
  });
  it("rejects replies without shapes", () => {
    expect(() => extractSvg("no svg here")).toThrow(InvalidSvgError);
    expect(() => extractSvg("<svg></svg>")).toThrow(InvalidSvgError);
  });
  it("extracts JSON from fenced replies", () => {
    expect(extractJson<{ a: number }>('ok ```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
});

const ILLUSTRATION = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">
<defs><linearGradient id="g"><stop offset="0" stop-color="red"/></linearGradient></defs>
<rect width="400" height="300" fill="#eee"/>
<g id="apple"><circle cx="50" cy="50" r="20" fill="url(#g)"/><path d="M50 30 L52 20"/></g>
<g id="pear"><ellipse cx="200" cy="60" rx="15" ry="25"/></g>
</svg>`;

describe("Process 4/5 tools", () => {
  it("tags shapes and crops a segment (r11 + r13 -> r15)", () => {
    const tagged = tagElements(ILLUSTRATION);
    expect(tagged).toContain('data-eid="e1"');
    expect(tagged).toContain('data-eid="e4"');
    expect(tagged).not.toMatch(/<stop[^>]*data-eid/);
    const crop = cropSvg(tagged, ["e2", "e3"], { x: 30, y: 20, w: 40, h: 50 });
    expect(crop).toContain("circle");
    expect(crop).not.toContain("ellipse");
    expect(crop).toContain('viewBox="28.0 18.0 44.0 54.0"');
    expect(crop).toContain("linearGradient");
  });

  it("only crops mark segments bound to a field", () => {
    const tagged = tagElements(ILLUSTRATION);
    const segs = [
      { id: "s1", name: "apple", elementIds: ["e2", "e3"], bbox: { x: 30, y: 20, w: 40, h: 50 } },
      { id: "s2", name: "pear", elementIds: ["e4"], bbox: { x: 185, y: 35, w: 30, h: 50 } },
    ];
    const crops = cropSegments(tagged, segs, [
      { segmentId: "s1", role: "mark", field: "fruit" },
      { segmentId: "s2", role: "anchor" },
    ]);
    expect(crops).toHaveLength(1);
    const r18 = composeVariantPrompts([{ ...crops[0], description: "a red apple" }], r1);
    expect(r18.map((v) => v.category)).toEqual(["Apple", "Pear", "Cherry", "Orange", "Plum"]);
    expect(r18[1].prompt).toContain("a red apple");
    expect(anchorsFromSegments(segs, [{ segmentId: "s1", role: "mark" }, { segmentId: "s2", role: "anchor" }])).toHaveLength(2);
  });

  it("prefixes ids and references", () => {
    const out = prefixIds('<svg><linearGradient id="g"/><rect fill="url(#g)"/><use href="#g"/></svg>', "p-");
    expect(out).toContain('id="p-g"');
    expect(out).toContain("url(#p-g)");
    expect(out).toContain('href="#p-g"');
  });

  it("unions boxes", () => {
    expect(unionBox([[0, 0, 10, 10], [5, 5, 10, 10]])).toEqual({ x: 0, y: 0, w: 15, h: 15 });
  });
});

describe("Process 6/7 tools", () => {
  const icon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40"/></svg>';
  const r19: Variant[] = ["Apple", "Pear", "Cherry", "Orange", "Plum"].map((c) => ({
    id: c, segmentId: "s1", category: c, prompt: "", aspect: { x: 0, y: 0, w: 1, h: 1 }, history: [], svg: icon, status: "done",
  }));
  const r21: ChartSpec = {
    categoryField: "fruit", valueField: "tons", aggregate: "sum", layouts: ["in-place", "isotype", "sized-row", "bars"],
    unitValue: 0, minSize: 20, maxSize: 80, sort: "desc", segmentId: "s1",
  };

  it("translates data to marks and composes all layouts (r22, r23)", () => {
    const r22 = marksFromData(r1, r21, r19);
    expect(r22.map((m) => m.category)[0]).toBe("Apple");
    const r23 = composeCharts(r22, [{ x: 10, y: 10, w: 40, h: 40, segmentId: "s1" }], r21);
    expect(r23.map((c) => c.layout)).toEqual(r21.layouts);
    for (const c of r23) {
      expect(Object.keys(c.positions).sort()).toEqual(["Apple", "Cherry", "Orange", "Pear", "Plum"]);
      expect(c.svg.match(/<svg/g)!.length).toBeGreaterThan(5);
    }
    // isotype: Apple 72 tons, auto unit 10 -> 7 full icons + partial
    expect(r23[1].svg).toContain("1 icon = 10");
  });

  it("matches rows and finalises (r25, r27)", () => {
    const r23 = composeCharts(marksFromData(r1, r21, r19), [], r21);
    const max = matchRows(r1, { field: "tons", op: "max", value: "" }, r23);
    expect(max.categories.map((c) => c.category)).toEqual(["Apple"]);
    const north = matchRows(r1, { field: "orchard", op: "=", value: "north" }, r23);
    expect(north.rowIndices).toEqual([0, 2, 4, 8]);
    const r27 = finalizeChart(r23, { chartIndex: 1, annotate: ["Apple"], title: "Harvest", subtitle: "", note: "src" });
    expect(r27).toContain("Harvest");
    expect(r27).toContain("Apple: 72");
  });
});
