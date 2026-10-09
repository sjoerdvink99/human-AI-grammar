import { describe, expect, it } from "vitest";
import { arrange, structureKey } from "./layout";
import { tutorialCanvas } from "./study";

const size = { width: 200, height: 120 };

describe("arrange", () => {
  const arranged = arrange(tutorialCanvas, () => size);
  const at = (id: string) => arranged.nodes.find((node) => node.id === id)!.position;

  it("lays the flow out left to right despite the loop", () => {
    const xs = ["prompt", "generate", "drafts", "select", "draft", "modify"].map((id) => at(id).x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(new Set(xs).size).toBe(xs.length);
  });

  it("keeps nodes apart", () => {
    const boxes = arranged.nodes.map(({ position }) => position);
    const overlap = boxes.some((a, i) => boxes.some((b, j) => i !== j && Math.abs(a.x - b.x) < size.width && Math.abs(a.y - b.y) < size.height));
    expect(overlap).toBe(false);
  });

  it("changes structure only when nodes or connections change", () => {
    expect(structureKey(arranged)).toBe(structureKey(tutorialCanvas));
    expect(structureKey({ ...tutorialCanvas, edges: tutorialCanvas.edges.slice(1) })).not.toBe(structureKey(tutorialCanvas));
  });
});
