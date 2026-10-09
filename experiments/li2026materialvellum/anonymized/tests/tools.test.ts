import { describe, expect, it } from "vitest";
import { beautifyStroke } from "../src/tools/tool1";
import { applyCamera, extrudeLayout } from "../src/tools/tool2";
import { composeCollage, composeLayout, composeRecords, deriveCamera, describeSketch, HEIGHT_PENS, renderScene, renderShapes, strokesToSelections, transcriptToCategory } from "../src/tools/tool3";
import { confineEditToRegions, InvalidOutput, validateSvg } from "../server/svg";
import type { Point, Stroke } from "../src/shared/types";

const jitter = (p: Point[], a = 1.5) => p.map((q, i) => ({ x: q.x + Math.sin(i * 7) * a, y: q.y + Math.cos(i * 5) * a }));
const rectPts = (x: number, y: number, w: number, h: number) => {
  const out: Point[] = [];
  for (let t = 0; t <= 1; t += 0.05) out.push({ x: x + w * t, y });
  for (let t = 0; t <= 1; t += 0.05) out.push({ x: x + w, y: y + h * t });
  for (let t = 0; t <= 1; t += 0.05) out.push({ x: x + w - w * t, y: y + h });
  for (let t = 0; t <= 1; t += 0.05) out.push({ x, y: y + h - h * t });
  return jitter(out);
};
const circlePts = (cx: number, cy: number, r: number) => jitter(Array.from({ length: 60 }, (_, i) => ({ x: cx + r * Math.cos((i / 59) * 2 * Math.PI), y: cy + r * Math.sin((i / 59) * 2 * Math.PI) })));
const stroke = (points: Point[], color: string = HEIGHT_PENS[1].color): Stroke => ({ id: Math.random().toString(), points, color, width: 3 });

describe("tool_1 beautify", () => {
  it("recognises a rectangle", () => expect(beautifyStroke(stroke(rectPts(100, 100, 200, 120))).kind).toBe("rectangle"));
  it("recognises an ellipse", () => expect(beautifyStroke(stroke(circlePts(300, 300, 80))).kind).toBe("ellipse"));
  it("recognises a line", () => {
    const s = beautifyStroke(stroke(jitter(Array.from({ length: 30 }, (_, i) => ({ x: 50 + i * 10, y: 200 })), 1)));
    expect(s.kind).toBe("line");
    expect(s.points).toHaveLength(2);
  });
});

describe("process 1 tools", () => {
  const shapes = [beautifyStroke(stroke(rectPts(100, 100, 200, 120), HEIGHT_PENS[2].color), { forceClosed: true, snap: 10 })];
  const layout = composeLayout(shapes);
  it("composes footprints with pen heights", () => expect(layout.footprints[0].height).toBe(30));
  it("extrudes, derives a camera, applies it and renders SVG", () => {
    const s1 = extrudeLayout(layout);
    expect(s1.camera).toBeNull();
    const s2 = applyCamera(s1, deriveCamera(s1));
    expect(s2.version).toBe(2);
    const svg = renderScene(s2);
    expect(svg).toMatch(/^<svg/);
    expect((svg.match(/<polygon/g) ?? []).length).toBeGreaterThan(3);
  });
  it("turns edit lassos into numbered selections + instructions", () => {
    const sh = beautifyStroke({ ...stroke(circlePts(200, 200, 50)), intent: "darken" }, { forceClosed: true });
    const { selections, instructions } = strokesToSelections([sh]);
    expect(selections[0].index).toBe(1);
    expect(instructions[0]).toMatch(/darker/);
  });
});

describe("process 2 tools", () => {
  it("renders and describes a sketch", () => {
    const sh = [beautifyStroke(stroke(circlePts(600, 100, 50), "#f5d90a"))];
    expect(renderShapes(sh)).toContain("<polygon");
    expect(describeSketch(sh)).toMatch(/yellow ellipse.*upper right/);
  });
});

describe("process 3 tools", () => {
  it("maps transcripts to the fixed category set", () => {
    expect(transcriptToCategory("a fluffy dog sitting under a tree")).toBe("animal");
    expect(transcriptToCategory("Big oak")).toBe("tree");
    expect(transcriptToCategory("something weird")).toBeNull();
  });
  it("composes records and a collage", () => {
    const boxes = [{ id: "b1", x: 10, y: 10, w: 100, h: 80 }];
    const recs = composeRecords("park", boxes, [{ boxId: "b1", category: "tree", transcript: "tree" }]);
    expect(recs[0]).toMatchObject({ label: "tree", globalPrompt: "park", position: "upper left" });
    const svg = composeCollage(recs, [{ boxId: "b1", svg: '<svg viewBox="0 0 100 80"><defs><linearGradient id="g"/></defs><rect fill="url(#g)"/></svg>' }], "park");
    expect(svg).toContain('id="i0_g"');
    expect(svg).toContain("url(#i0_g)");
  });
});

describe("server svg validation", () => {
  it("extracts and sanitises", () => {
    const s = validateSvg('Here:\n```<svg viewBox="0 0 10 10" onload="x()"><script>bad()</script><rect/><circle/></svg>```');
    expect(s).not.toMatch(/script|onload/);
    expect(s).toContain('xmlns="http://www.w3.org/2000/svg"');
  });
  it("rejects non-svg", () => expect(() => validateSvg("sorry")).toThrow(InvalidOutput));
  it("confines edits to regions", () => {
    const out = confineEditToRegions('<svg viewBox="0 0 800 600"><rect id="a"/></svg>', '<svg viewBox="0 0 800 600"><circle/></svg>', [[{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]]);
    expect(out).toContain("<mask");
    expect(out).toContain('id="o_a"');
  });
});
