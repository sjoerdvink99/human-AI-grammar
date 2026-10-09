import { describe, expect, it } from "vitest";
import { parseAll } from "../test-fixtures";
import { connections } from "./connections";

const [draft, refine, export_, other] = parseAll(
  "(p_1: instruction language) -> [model generate]~ -> (d_1: artifact language)",
  "(d_1: artifact language) -> [human modify] -> (d_2: artifact language)",
  "(d_2: artifact language) -> [tool translate] -> (f_1: artifact formal)",
  "(x_1: instruction language) -> [model generate]~ -> (d_5: artifact language)",
);

describe("connections", () => {
  it("links a process to the ones that start from its result", () => {
    expect(connections([draft, refine, export_])).toEqual([
      { from: 0, to: 1, kind: "continues", via: ["d_1"] },
      { from: 1, to: 2, kind: "continues", via: ["d_2"] },
      { from: 0, to: 2, kind: "shares", via: ["d"] },
    ]);
  });

  it("skips unparsed processes and reports shared representations", () => {
    expect(connections([draft, null, other])).toEqual([{ from: 0, to: 2, kind: "shares", via: ["d"] }]);
  });

});
