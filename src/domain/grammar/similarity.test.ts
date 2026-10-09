import { describe, expect, it } from "vitest";
import { parseAll } from "../test-fixtures";
import { extractFeatures } from "./features";
import { closeness, jaccard, similarity } from "./similarity";

const generate = extractFeatures(parseAll("(p: instruction language) -> [model generate]~ -> (a: artifact language)"));
const execute = extractFeatures(parseAll("(g: selection spatial) -> [tool execute] -> (o: evaluation audio)"));

describe("similarity", () => {
  it("computes Jaccard similarity with empty sets as identical", () => {
    expect(jaccard(["a", "b"], ["b", "c"])).toBeCloseTo(1 / 3);
    expect(jaccard([], [])).toBe(1);
  });

  it("computes normalized numeric closeness", () => {
    expect(closeness(2, 4)).toBe(0.5);
    expect(closeness(0, 0)).toBe(1);
  });

  it("scores identical systems as 1", () => {
    expect(similarity(generate, generate)).toMatchObject({ overall: 1, representation: 1, transformation: 1 });
  });

  it("is symmetric and bounded", () => {
    const forward = similarity(generate, execute);
    const backward = similarity(execute, generate);
    expect(forward.overall).toBeCloseTo(backward.overall);
    expect(forward.overall).toBeGreaterThanOrEqual(0);
    expect(forward.overall).toBeLessThan(1);
    expect(forward.overall).toBeCloseTo((forward.representation + forward.transformation) / 2);
  });

  it("separates disjoint vocabularies", () => {
    const roles = similarity(generate, execute).components.find((component) => component.label === "Roles");
    expect(roles?.score).toBe(0);
  });
});
