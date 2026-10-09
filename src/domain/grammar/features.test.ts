import { describe, expect, it } from "vitest";
import { parseAll } from "../test-fixtures";
import { extractFeatures } from "./features";

describe("extractFeatures", () => {
  const features = extractFeatures(
    parseAll(
      "(p: instruction language) -> [model generate]~ -> (a: artifact language)",
      "(a: artifact language) -> [human select] -> (a: artifact language) + (r: selection spatial) -> [tool translate] -> (p2: instruction language)",
      "(p2: instruction language) -> [model_2 modify]~ -> (b: artifact language)",
    ),
  );

  it("counts states, distinct representations, and transforms", () => {
    expect(features).toMatchObject({
      processCount: 3,
      stateCount: 7,
      representationCount: 5,
      transformCount: 4,
      humanTransformCount: 1,
      modelTransformCount: 2,
      toolTransformCount: 1,
      stochasticTransformCount: 2,
      uniqueRoles: 3,
      uniqueMedia: 2,
      uniqueOperations: 4,
    });
  });

  it("collects vocabulary counts over distinct representations", () => {
    expect(features.roles).toEqual({ instruction: 2, artifact: 2, selection: 1 });
    expect(features.representationTypes["selection spatial"]).toBe(1);
  });

  it("tracks actor-operation pairs, handoffs, and sizes", () => {
    expect(features.actorOperationPairs).toEqual({
      "model generate": 1,
      "human select": 1,
      "tool translate": 1,
      "model modify": 1,
    });
    expect(features.handoffs).toEqual({ "model → human": 1, "human → tool": 1, "tool → model": 1 });
    expect(features.stateSizes).toEqual([1, 1, 1, 2, 1, 1, 1]);
    expect(features.processLengths).toEqual([1, 2, 1]);
  });

  it("returns zeroed features for an empty system", () => {
    expect(extractFeatures([])).toMatchObject({ stateCount: 0, transformCount: 0, uniqueRoles: 0 });
  });
});
