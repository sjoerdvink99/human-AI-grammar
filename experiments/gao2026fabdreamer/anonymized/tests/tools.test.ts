import { describe, expect, it } from "vitest";
import {
  boxesToParts, checkBoxes, composeExport, cropSvg, imageToPart, initialParts, normalizeReference, placementsToParts,
  refinePartsFromViews, sanitizeSvg, toDrawingSvg, toOpenScad, viewBoxOf,
} from "../src/shared/tools1";
import { composeAssembly, aabb } from "../src/shared/tools2";
import { applyOps, runFabChecks } from "../src/shared/tools3";
import type { Box2D, Constraints, Part3D, PartRecord } from "../src/shared/types";

const records: PartRecord[] = [
  { id: "top", name: "top", shape: "box", material: "plywood", size: { w: 400, h: 20, d: 300 }, zHint: "center", attachTo: null, notes: "" },
  { id: "leg_l", name: "left leg", shape: "box", material: "plywood", size: { w: 30, h: 380, d: 30 }, zHint: "front", attachTo: "top", notes: "" },
  { id: "leg_r", name: "right leg", shape: "cylinder", material: "steel", size: { w: 30, h: 380, d: 30 }, zHint: "back", attachTo: "top", notes: "" },
];
const boxes: Box2D[] = [
  { partId: "top", x: 56, y: 100, w: 400, h: 20, confidence: 0.9 },
  { partId: "leg_l", x: 66, y: 120, w: 30, h: 380, confidence: 0.9 },
  { partId: "leg_r", x: 416, y: 120, w: 30, h: 380, confidence: 0.9 },
];
const C: Constraints = { method: "laser-cut sheet", material: "plywood", sheetThickness: 6, minThickness: 3, maxW: 1000, maxH: 1000, maxD: 1000 };

describe("tool_1", () => {
  it("sanitizes SVG", () => {
    const s = sanitizeSvg('junk <svg viewBox="0 0 10 10" onload="x()"><script>alert(1)</script><image href="http://evil/x.png"/></svg> tail');
    expect(s.startsWith("<svg")).toBe(true);
    expect(s).not.toMatch(/script|onload|evil/);
    expect(s).toMatch(/xmlns=/);
    expect(() => sanitizeSvg("no svg here")).toThrow();
  });
  it("normalizes into a 512 canvas", () => {
    const n = normalizeReference('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><rect width="100" height="50"/></svg>');
    expect(viewBoxOf(n)).toEqual({ x: 0, y: 0, w: 512, h: 512 });
    expect(n).toMatch(/scale\(5\.12\)/);
  });
  it("crops by viewBox", () => {
    const c = cropSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512"><circle r="5"/></svg>', { x: 10, y: 20, w: 100, h: 50 }, 0);
    expect(viewBoxOf(c)).toEqual({ x: 10, y: 20, w: 100, h: 50 });
    expect(c).toMatch(/<circle/);
  });
  it("maps boxes to 3D parts at the selected size", () => {
    const parts = boxesToParts(initialParts(records), records, boxes, { w: 400, h: 400, d: 300 });
    const top = parts.find((p) => p.id === "top")!;
    expect(top.size.w).toBeCloseTo(400);
    expect(top.position.y).toBeCloseTo(390);
    const legL = parts.find((p) => p.id === "leg_l")!;
    expect(legL.position.y).toBeCloseTo(190);
    expect(legL.position.z).toBeGreaterThan(0);
    expect(parts.find((p) => p.id === "leg_r")!.position.z).toBeLessThan(0);
    expect(legL.imageBox).toBeDefined();
  });
  it("checks boxes", () => {
    const checks = checkBoxes([...boxes.slice(0, 2), { ...boxes[1], partId: "leg_r" }], records);
    expect(checks.find((c) => c.partId === "top")!.pass).toBe(true);
    expect(checks.find((c) => c.partId === "leg_r")!.issues.join()).toMatch(/duplicates/);
    expect(checkBoxes([], records).every((c) => !c.pass)).toBe(true);
  });
  it("refines depth from side views", () => {
    const sv = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect x="100" y="0" width="60" height="512"/></svg>';
    const out = refinePartsFromViews(initialParts(records), records, boxes, { w: 400, h: 400, d: 300 },
      [{ partId: "leg_l", svg: sv }], [{ partId: "leg_l", x: 100, y: 0, w: 60, h: 512, confidence: 1 }]);
    const leg = out.find((p) => p.id === "leg_l")!;
    expect(leg.shape).toBe("profile");
    expect(leg.profileAxis).toBe("x");
    expect(leg.size.d).toBeCloseTo(380 * (60 / 512), 0);
  });
  it("turns an image into a part", () => {
    const p = imageToPart("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 512 512'></svg>", { partId: "", x: 0, y: 0, w: 100, h: 200, confidence: 1 }, { name: "arm", height: 300, depth: 6, material: "oak" });
    expect(p.size).toEqual({ w: 150, h: 300, d: 6 });
  });
  it("turns placements into parts", () => {
    const out = placementsToParts(
      [{ key: "k0", action: "replace", replacesId: "top", name: "new top", shape: "box", material: "oak", size: { w: 1, h: 1, d: 1 }, placement: "", anchor: null }],
      [{ key: "k0", position: { x: 0, y: 100, z: 0 }, size: { w: 300, h: 18, d: 200 } }]);
    expect(out[0].id).toBe("top");
    expect(out[0].replacesId).toBe("top");
  });
  it("exports OpenSCAD, drawings and a bundle", () => {
    const asm = composeAssembly(boxesToParts(initialParts(records), records, boxes, { w: 400, h: 400, d: 300 }));
    const scad = toOpenScad(asm, "Side table");
    expect(scad[0].content).toMatch(/cube\(\[400, 300, 20\], center = true\)/);
    expect(scad[0].content).toMatch(/cylinder\(d = 30/);
    const svg = toDrawingSvg(asm.parts[0], C);
    expect(svg).toMatch(/FRONT/);
    const b = composeExport("full", "Side table", asm, C, scad, [{ name: "d.svg", content: svg }]);
    expect(b.files.map((f) => f.name)).toContain("bom.csv");
    expect(composeExport("drawings", "x", asm, C, scad, [{ name: "d.svg", content: svg }]).files).toHaveLength(1);
  });
});

describe("tool_2", () => {
  it("composes onto the ground, centred", () => {
    const parts: Part3D[] = initialParts(records).map((p) => ({ ...p, position: { ...p.position, y: p.position.y + 100 } }));
    const asm = composeAssembly(parts);
    const minY = Math.min(...asm.parts.map((p) => aabb(p).min.y));
    expect(minY).toBeCloseTo(0);
  });
});

describe("tool_3", () => {
  const asm = composeAssembly(boxesToParts(initialParts(records), records, boxes, { w: 400, h: 400, d: 300 }));
  it("flags sheet thickness, floating parts and bounds", () => {
    const checks = runFabChecks(asm, { ...C, maxW: 300 });
    expect(checks.some((c) => c.kind === "bounds")).toBe(true);
    expect(checks.some((c) => c.kind === "sheet")).toBe(true);
    const floating = { parts: [...asm.parts, { ...asm.parts[0], id: "float", position: { x: 0, y: 2000, z: 0 } }] };
    expect(runFabChecks(floating, C).some((c) => c.kind === "floating" && c.partIds.includes("float"))).toBe(true);
  });
  it("detects tipping", () => {
    const tipping = { parts: [
      { ...asm.parts[1], id: "base", size: { w: 50, h: 10, d: 50 }, position: { x: 0, y: 5, z: 0 } },
      { ...asm.parts[1], id: "heavy", size: { w: 400, h: 400, d: 400 }, position: { x: 300, y: 210, z: 0 } },
    ] };
    expect(runFabChecks(tipping, C).find((c) => c.kind === "stability")?.severity).toBe("error");
  });
  it("applies ops", () => {
    const { assembly, skipped } = applyOps(asm, [
      { op: "move", partId: "top", position: { x: 1, y: 2, z: 3 } },
      { op: "delete", partId: "leg_r" },
      { op: "add", name: "shelf", shape: "box", size: { w: 300, h: 6, d: 200 }, position: { x: 0, y: 100, z: 0 } },
      { op: "resize", partId: "nope", size: { w: 1, h: 1, d: 1 } },
    ]);
    expect(assembly.parts.find((p) => p.id === "top")!.position).toEqual({ x: 1, y: 2, z: 3 });
    expect(assembly.parts.some((p) => p.id === "leg_r")).toBe(false);
    expect(assembly.parts.some((p) => p.name === "shelf")).toBe(true);
    expect(skipped).toHaveLength(1);
  });
});
