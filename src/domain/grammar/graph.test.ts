import { describe, expect, it } from "vitest";
import { parseAll } from "../test-fixtures";
import { processGraph } from "./graph";

const [draft, refine] = parseAll(
  "(p_1: instruction language) -> [model generate]~ -> (p_1: instruction language) + (d_1: artifact language)",
  "(d_1: artifact language) -> [human modify] -> (d_2: artifact language)",
);

describe("processGraph", () => {
  it("joins processes on shared identifiers and layers them by depth", () => {
    const graph = processGraph([draft!, refine!]);
    expect(graph.nodes.map(({ representation, layer }) => [representation.id, layer])).toEqual([
      ["p_1", 0],
      ["d_1", 1],
      ["d_2", 2],
    ]);
    expect(graph.edges.map(({ from, to, transform }) => [from, to, transform.operation])).toEqual([
      ["p_1", "d_1", "generate"],
      ["d_1", "d_2", "modify"],
    ]);
  });

  it("keeps a representation that drops out and returns in its original place", () => {
    const [process] = parseAll(
      "(c_1: artifact spatial) -> [human select] -> (s_1: selection spatial) -> [tool compose] -> (c_1: artifact spatial) + (n_1: artifact spatial)",
    );
    const graph = processGraph([process!]);
    expect(graph.nodes.map(({ representation, layer }) => [representation.id, layer])).toEqual([
      ["c_1", 0],
      ["s_1", 1],
      ["n_1", 2],
    ]);
  });
});
