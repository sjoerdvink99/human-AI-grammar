import { describe, expect, it } from "vitest";
import { processGraph } from "@/domain/grammar/graph";
import { parseAll } from "@/domain/test-fixtures";
import { layoutGraph } from "./graph-layout";

describe("layoutGraph", () => {
  it("keeps a representation in its row through carried copies and later versions", () => {
    const [process] = parseAll(
      "(c_1: artifact language) + (t_1: artifact record) + (m_1: artifact record) -> [human specify] -> (c_1: artifact language) + (t_1: artifact record) + (m_1: artifact record) + (p_1: instruction language) -> [model extract]~ -> (c_1: artifact language) + (t_2: artifact record) + (m_2: artifact record) -> [tool compose] -> (s_1: artifact record)",
    );
    const graph = processGraph([process!]);
    const { boxes } = layoutGraph(graph, () => 40, () => 40);
    const order = (layer: number) =>
      graph.nodes
        .filter((node) => node.layer === layer)
        .sort((a, b) => boxes.get(a.key)!.y - boxes.get(b.key)!.y)
        .map((node) => node.key);
    expect(order(0)).toEqual(["c_1", "t_1", "m_1"]);
    expect(order(2)).toEqual(["c_1@2", "t_2", "m_2"]);
  });
});
