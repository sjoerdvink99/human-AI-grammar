import { describe, expect, it } from "vitest";
import { parseAll } from "../test-fixtures";
import { processGraph } from "./graph";

const graphOf = (expression: string) => processGraph(parseAll(expression)[0]!);

const summary = (expression: string) =>
  graphOf(expression).nodes.map(({ key, row, carried, through }) => [key, row, carried ? (through ? "through" : "carried") : "new"]);

describe("processGraph", () => {
  it("draws one column per state with each step between neighbouring columns", () => {
    const graph = graphOf("(p_1: instruction language) -> [model generate]~ -> (d_1: artifact language) -> [human modify] -> (d_2: artifact language)");
    expect(graph.columns).toBe(3);
    expect(graph.steps.map(({ column, inputs, outputs }) => [column, inputs, outputs])).toEqual([
      [0, ["p_1@0"], ["d_1@1"]],
      [1, ["d_1@1"], ["d_2@2"]],
    ]);
  });

  it("keeps a carried representation in its row and draws it again only where it is read and at the end", () => {
    expect(
      summary(
        "(c_1: artifact record) -> [model extract]~ -> (c_1: artifact record) + (k_1: label language) -> [human modify] -> (c_1: artifact record) + (k_2: label language) -> [tool compose] -> (c_1: artifact record) + (n_1: artifact record)",
      ),
    ).toEqual([
      ["c_1@0", 0, "new"],
      ["c_1@1", 0, "through"],
      ["k_1@1", 1, "new"],
      ["c_1@2", 0, "through"],
      ["k_2@2", 1, "new"],
      ["c_1@3", 0, "carried"],
      ["n_1@3", 1, "new"],
    ]);
  });

  it("reads what was just introduced or consumed and carries the rest as context", () => {
    const graph = graphOf(
      "(t_1: instruction language) + (c_1: artifact record) -> [model select]~ -> (t_1: instruction language) + (d_1: selection categorical) -> [tool compose] -> (t_1: instruction language) + (p_1: instruction record)",
    );
    expect(graph.steps.map(({ inputs }) => inputs)).toEqual([["t_1@0", "c_1@0"], ["d_1@1"]]);
  });

  it("falls back to the whole state when nothing was introduced or consumed", () => {
    const graph = graphOf(
      "(a_1: artifact language) + (b_1: artifact language) -> [human select] -> (a_1: artifact language) -> [model generate]~ -> (a_1: artifact language) + (n_1: artifact language)",
    );
    expect(graph.steps[1].inputs).toEqual(["a_1@1"]);
  });

  it("gives a new version the row of the version it replaces", () => {
    expect(summary("(x_1: artifact language) + (y_1: artifact language) -> [human modify] -> (x_1: artifact language) + (y_2: artifact language)")).toEqual([
      ["x_1@0", 0, "new"],
      ["y_1@0", 1, "new"],
      ["x_1@1", 0, "carried"],
      ["y_2@1", 1, "new"],
    ]);
  });

  it("draws a step that closes a loop as a return to the earlier state, without repeating that state", () => {
    const graph = graphOf(
      "(p_1: instruction language) -> [model generate]~ -> (p_1: instruction language) + (i_1: artifact visual) -> [human modify] -> (p_1: instruction language)",
    );
    expect(graph.columns).toBe(2);
    expect(graph.steps[1]).toMatchObject({ column: 1, inputs: ["i_1@1"], outputs: [], back: 0 });
  });

  it("shows everything in a state a loop returns to", () => {
    const graph = graphOf(
      "(c_1: artifact record) -> [human specify] -> (c_1: artifact record) + (q_1: instruction language) -> [model generate]~ -> (c_1: artifact record) + (q_1: instruction language) + (a_1: artifact language) -> [human modify] -> (c_1: artifact record) + (q_1: instruction language)",
    );
    expect(graph.nodes.find((node) => node.key === "c_1@1")).toMatchObject({ carried: true });
    expect(graph.nodes.find((node) => node.key === "c_1@1")?.through).toBeUndefined();
  });
});
