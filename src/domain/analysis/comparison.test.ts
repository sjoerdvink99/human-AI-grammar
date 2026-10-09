import { describe, expect, it } from "vitest";
import { entry } from "../test-fixtures";
import { pairwiseSimilarity, partitionField, partitionTerms, repeated } from "./comparison";

describe("partitionTerms", () => {
  it("separates shared terms from terms unique to one set", () => {
    expect(partitionTerms([["a", "b", "c"], ["b", "c", "d"], ["c", "e"]])).toEqual({
      shared: ["c"],
      unique: [["a"], ["d"], ["e"]],
    });
  });
});

describe("system comparison", () => {
  const a = entry(1, "A", ["(p: instruction language) -> [model generate]~ -> (x: artifact visual) -> [model generate]~ -> (y: artifact visual)"]);
  const b = entry(2, "B", ["(p: instruction language) -> [human modify] -> (q: instruction spatial)"]);

  it("partitions vocabulary fields across systems", () => {
    expect(partitionField([a, b], "media")).toEqual({ shared: ["language"], unique: [["visual"], ["spatial"]] });
  });

  it("finds repeated actor-operation pairs", () => {
    expect(repeated(a.features.actorOperationPairs)).toEqual([["model generate", 2]]);
    expect(repeated(b.features.actorOperationPairs)).toEqual([]);
  });

  it("computes every unordered pair once", () => {
    const c = entry(3, "C", ["(p: instruction language) -> [tool execute] -> (r: artifact formal)"]);
    expect(pairwiseSimilarity([a, b, c]).map(({ a, b }) => `${a.name}${b.name}`)).toEqual(["AB", "AC", "BC"]);
  });
});
