import { describe, expect, it } from "vitest";
import { parseAll } from "../test-fixtures";
import { dependencies, flow } from "./flow";

const [draft, refine, export_, other, review] = parseAll(
  "(p_1: instruction language) -> [model generate]~ -> (d_1: artifact language) + (n_1: artifact language) -> [tool compose] -> (d_1: artifact language)",
  "(d_1: artifact language) -> [human modify] -> (d_2: artifact language)",
  "(d_1: artifact language) + (d_2: artifact language) -> [tool translate] -> (f_1: artifact formal)",
  "(x_1: instruction language) -> [model generate]~ -> (y_1: artifact language)",
  "(f_1: artifact formal) -> [human evaluate] -> (p_1: instruction language)",
);

describe("dependencies", () => {
  it("links a process to the ones that start from anything it produces", () => {
    expect(dependencies([draft, refine, export_])).toEqual([
      { from: 0, to: 1, via: ["d_1"] },
      { from: 0, to: 2, via: ["d_1"] },
      { from: 1, to: 2, via: ["d_2"] },
    ]);
  });

  it("skips unparsed processes", () => {
    expect(dependencies([draft, null, refine])).toEqual([{ from: 0, to: 2, via: ["d_1"] }]);
  });
});

describe("flow", () => {
  it("orders processes into stages and drops implied links", () => {
    const { stages, links } = flow([draft, refine, export_, other]);
    expect(stages).toEqual([[0, 3], [1], [2]]);
    expect(links).toEqual([
      { from: 0, to: 1, back: false },
      { from: 1, to: 2, back: false },
    ]);
  });

  it("marks links that loop back to an earlier stage", () => {
    const { stages, links } = flow([draft, refine, export_, review]);
    expect(stages).toEqual([[0], [1], [2], [3]]);
    expect(links).toContainEqual({ from: 3, to: 0, back: true });
  });
});
