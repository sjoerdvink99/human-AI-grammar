import { describe, expect, it } from "vitest";
import { addSnapshot, composeIllustrationRequest, composeSceneSpec } from "../shared/compose";
import { renderScene } from "../shared/render";
import { linkedImages, locateQuote, retrieveProvenance } from "../shared/provenance";
import { parseTable } from "../shared/table";
import { renderChart } from "../shared/chart";
import { autoPlacements, composePictorial, pointInPolygon } from "../shared/pictorial";
import { sanitizeSvg, validateElement } from "../shared/sanitize";
import { CHART_TYPES, type VisualElement } from "../shared/types";

const el = (p: Partial<VisualElement> = {}): VisualElement => ({
  id: "e1", name: "Hive", kind: "illustration", description: "A rooftop hive", text: "", x: 10, y: 20, w: 200, h: 150,
  color: "#f2b134", svg: '<circle cx="50" cy="50" r="40"/>', sources: [], ...p,
});

describe("sanitize / validate (model_1 output validation)", () => {
  it("strips scripts, handlers and external refs", () => {
    const s = sanitizeSvg('<svg><script>alert(1)</script><rect onclick="x()" width="5" fill="url(http://x)"/><image href="http://x"/><a href="j">t</a></svg>');
    expect(s).not.toMatch(/script|onclick|http|image|<a/);
    expect(s).toContain("<rect");
  });
  it("clamps geometry, drops unknown docs and kinds", () => {
    const v = validateElement({ kind: "weird", x: -50, y: 5000, w: 99999, h: 10, sources: [{ docId: "d9", quote: "q" }, { docId: "d1", quote: "ok" }] }, 0, new Set(["d1"]));
    expect(v.kind).toBe("shape");
    expect(v.x).toBe(0);
    expect(v.w).toBe(1000);
    expect(v.h).toBe(20);
    expect(v.y).toBe(680);
    expect(v.sources).toEqual([{ docId: "d1", quote: "ok" }]);
  });
});

describe("process 1 / 3 tools", () => {
  it("tool_1 → tool_2 render elements with escaping", () => {
    const spec = composeSceneSpec([el(), el({ id: "h", kind: "headline", text: "Bees <3 cities" })]);
    expect(spec.layers.map((l) => l.elementId)).toEqual(["e1", "h"]);
    const scene = renderScene(spec);
    expect(scene.svg).toContain("&lt;3");
    expect(scene.svg).toContain('data-element-id="e1"');
    expect(scene.svg).not.toContain("<3");
  });
  it("tool_7 keeps earlier rounds", () => {
    const s1 = addSnapshot([], { svg: "<svg/>", width: 1, height: 1 });
    const s2 = addSnapshot(s1, { svg: "<svg></svg>", width: 1, height: 1 }, "too busy");
    expect(s2.map((s) => s.round)).toEqual([1, 2]);
    expect(s2[1].critique).toBe("too busy");
  });
});

describe("process 2 tool_3", () => {
  const docs = [{ id: "d1", title: "Report", text: "City hives grew from 310 in 2015\n to 1,240 in 2024. Bees forage widely." }];
  it("locates quotes despite whitespace and case", () => {
    expect(locateQuote(docs[0].text, "grew from 310 in 2015 to 1,240")).not.toBeNull();
    expect(locateQuote(docs[0].text, "BEES FORAGE")).not.toBeNull();
    expect(locateQuote(docs[0].text, "nothing like this")).toBeNull();
  });
  it("retrieves passage and linked images", () => {
    const images = [
      { id: "i1", name: "a.png", caption: "rooftop hive photo", docId: "", dataUrl: "" },
      { id: "i2", name: "b.png", caption: "unrelated", docId: "d1", dataUrl: "" },
      { id: "i3", name: "c.png", caption: "traffic", docId: "", dataUrl: "" },
    ];
    const e = el({ sources: [{ docId: "d1", quote: "1,240 in 2024" }] });
    const r = retrieveProvenance(e, docs, images);
    expect(r.passages[0].found).toBe(true);
    expect(r.passages[0].match).toBe("1,240 in 2024");
    expect(r.images.map((i) => i.id)).toEqual(["i2", "i1"]);
    expect(linkedImages(el(), images).map((i) => i.id)).toEqual(["i1"]);
  });
});

describe("process 4 tool_1", () => {
  it("composes an illustration request", () => {
    const r = composeIllustrationRequest(el({ w: 300, h: 100 }));
    expect(r.subject).toBe("Hive");
    expect(r.aspect).toBe("landscape");
    expect(r.palette[0]).toBe("#f2b134");
  });
});

describe("process 5 tool_4", () => {
  const t = parseTable('city,kg\n"Den Haag, NL",16\nUtrecht,18\n');
  it("parses CSV with quotes", () => {
    expect(t.columns).toEqual(["city", "kg"]);
    expect(t.rows[0]).toEqual(["Den Haag, NL", 16]);
  });
  it("renders every chart type with marks", () => {
    for (const type of CHART_TYPES) {
      const c = renderChart(t, type);
      expect(c.svg.startsWith("<svg")).toBe(true);
      expect(c.marks.length).toBe(2);
    }
  });
});

describe("processes 6 / 7 tools", () => {
  it("point in polygon", () => {
    const sq = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    expect(pointInPolygon({ x: 5, y: 5 }, sq)).toBe(true);
    expect(pointInPolygon({ x: 15, y: 5 }, sq)).toBe(false);
  });
  it("tool_6 composes cutout onto chart", () => {
    const chart = renderChart(parseTable("a,b\nx,1\ny,2"), "column");
    const pl = autoPlacements(chart, 50, 50, "marks");
    expect(pl).toHaveLength(2);
    const svg = composePictorial(chart, { dataUrl: "data:image/png;base64,AAA", width: 50, height: 50 }, pl);
    expect(svg.match(/<image /g)).toHaveLength(2);
    expect(svg.endsWith("</svg>")).toBe(true);
  });
});
