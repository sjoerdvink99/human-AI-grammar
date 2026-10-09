import { describe, expect, it } from "vitest";
import { processGraph } from "@/domain/grammar/graph";
import { parseAll } from "@/domain/test-fixtures";
import { layoutGraph } from "./graph-layout";

const layoutOf = (expression: string) => {
  const graph = processGraph(parseAll(expression)[0]!);
  return { graph, layout: layoutGraph(graph, () => 40, () => 40) };
};

describe("layoutGraph", () => {
  it("keeps a carried representation on one straight line", () => {
    const { layout } = layoutOf(
      "(c_1: artifact language) + (p_1: instruction language) -> [model generate]~ -> (c_1: artifact language) + (d_1: artifact language) -> [human modify] -> (c_1: artifact language) + (d_2: artifact language)",
    );
    const ys = ["c_1@0", "c_1@1", "c_1@2"].map((key) => layout.boxes.get(key)!.y);
    expect(new Set(ys).size).toBe(1);
    expect(layout.boxes.get("c_1@1")!.width).toBe(0);
  });

  it("draws one arc and one band for a loop", () => {
    const { layout } = layoutOf(
      "(p_1: instruction language) -> [model generate]~ -> (p_1: instruction language) + (i_1: artifact visual) -> [human modify] -> (p_1: instruction language)",
    );
    expect(layout.strokes.filter((stroke) => stroke.key.startsWith("loop:"))).toHaveLength(1);
    expect(layout.labels.filter((label) => label.loop)).toHaveLength(1);
    expect(layout.bands).toHaveLength(1);
  });
});
