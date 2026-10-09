import { describe, expect, it } from "vitest";
import { entry } from "../test-fixtures";
import { composition, findCompositionKind, foldParts } from "./composition";

const entries = [
  entry(1, "DirectGPT", [
    "(p: instruction language) -> [model generate]~ -> (a: artifact language)",
    "(a: artifact language) -> [human select] -> (r: selection spatial)",
  ]),
  entry(2, "Runner", ["(c: artifact formal) -> [tool execute] -> (o: artifact visual) -> [model evaluate] -> (s: evaluation language)"]),
];

describe("composition", () => {
  it("sums counts across systems, largest first, without empty parts", () => {
    expect(composition(entries, findCompositionKind("actors")!)).toEqual([
      { value: "model", count: 2 },
      { value: "human", count: 1 },
      { value: "tool", count: 1 },
    ]);
  });

  it("counts representations by medium", () => {
    expect(composition(entries, findCompositionKind("media")!)[0]).toEqual({ value: "language", count: 3 });
  });

  it("folds parts outside the kept set into one remainder", () => {
    const parts = composition(entries, findCompositionKind("actors")!);
    expect(foldParts(parts, new Set(["model"]), "Other")).toEqual([
      { value: "model", count: 2 },
      { value: "Other", count: 2 },
    ]);
    expect(foldParts(parts, new Set(["model", "human", "tool"]))).toEqual(parts);
  });
});
