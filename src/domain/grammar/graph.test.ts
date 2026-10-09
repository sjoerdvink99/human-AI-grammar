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

  it("draws a step that returns an earlier identifier as an edge back to it", () => {
    const [process] = parseAll(
      "(p_1: instruction language) -> [model generate]~ -> (i_1: artifact visual) -> [human modify] -> (p_1: instruction language)",
    );
    const graph = processGraph([process!]);
    expect(graph.edges.map(({ from, to, back }) => [from, to, !!back])).toEqual([
      ["p_1", "i_1", false],
      ["i_1", "p_1", true],
    ]);
    expect(graph.nodes.map(({ representation, layer }) => [representation.id, layer])).toEqual([
      ["p_1", 0],
      ["i_1", 1],
    ]);
  });

  it("reads what was just introduced or consumed and carries the rest as context", () => {
    const [process] = parseAll(
      "(t_1: instruction language) + (c_1: artifact record) -> [model select]~ -> (t_1: instruction language) + (d_1: selection categorical) -> [model select]~ -> (t_1: instruction language) + (s_1: selection categorical) -> [tool compose] -> (t_1: instruction language) + (p_1: instruction record)",
    );
    const graph = processGraph([process!]);
    expect(graph.edges.map(({ from, to, transform }) => [from, to, transform.operation])).toEqual([
      ["t_1", "d_1", "select"],
      ["c_1", "d_1", "select"],
      ["d_1", "s_1", "select"],
      ["s_1", "p_1", "compose"],
    ]);
    expect(graph.nodes.some((node) => node.carried)).toBe(false);
  });

  it("draws an input carried from further back as a copy next to the step that reads it", () => {
    const [process] = parseAll(
      "(c_1: artifact record) -> [model extract]~ -> (k_1: label language) + (c_1: artifact record) -> [human modify] -> (k_2: label language) + (c_1: artifact record) -> [tool compose] -> (n_1: artifact record)",
    );
    const graph = processGraph([process!]);
    expect(graph.nodes.map(({ key, layer, carried }) => [key, layer, carried ?? false])).toEqual([
      ["c_1", 0, false],
      ["k_1", 1, false],
      ["k_2", 2, false],
      ["n_1", 3, false],
      ["c_1@2", 2, true],
    ]);
    expect(graph.edges.map(({ from, to }) => [from, to])).toEqual([
      ["c_1", "k_1"],
      ["k_1", "k_2"],
      ["k_2", "n_1"],
      ["c_1@2", "n_1"],
    ]);
  });

  it("falls back to the whole state when nothing was introduced or consumed", () => {
    const [process] = parseAll(
      "(a_1: artifact language) + (b_1: artifact language) -> [human select] -> (a_1: artifact language) -> [model generate]~ -> (a_1: artifact language) + (n_1: artifact language)",
    );
    expect(processGraph([process!]).edges.map(({ from, to }) => [from, to])).toEqual([["a_1", "n_1"]]);
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
