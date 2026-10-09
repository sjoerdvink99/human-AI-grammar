import { describe, expect, it } from "vitest";
import { entry } from "../test-fixtures";
import {
  emptyQuery,
  filterEntries,
  hasActor,
  hasActorOperation,
  hasRepresentationType,
  hasCollection,
  hasGenerativeTransform,
  hasLoop,
  isQueryActive,
  matchesText,
  minTransforms,
} from "./filters";

const direct = entry(1, "DirectGPT", [
  "(p: instruction language) -> [model generate]~ -> (a: artifact language)",
  "(a: artifact language) -> [human select] -> (a: artifact language) + (r: selection spatial)",
  "(a: artifact language) -> [human modify] -> (b: artifact language) -> [human select] -> (a: artifact language)",
]);
const runner = entry(2, "Runner", ["(c: artifact formal) -> [tool execute] -> (o: artifact visual)* -> [model_1 evaluate] -> (s: evaluation language)"], {
  year: 2021,
  venue: "UIST",
});
const entries = [direct, runner];

describe("predicates", () => {
  it("match actors and actor-operation pairs", () => {
    expect(entries.filter(hasActor("tool"))).toEqual([runner]);
    expect(entries.filter(hasActorOperation("human", "modify"))).toEqual([direct]);
    expect(entries.filter(hasActorOperation("model", "evaluate"))).toEqual([runner]);
  });

  it("match role-medium representation types, generative steps, collections, and loops", () => {
    expect(entries.filter(hasRepresentationType("selection", "spatial"))).toEqual([direct]);
    expect(entries.filter(hasRepresentationType("artifact", "formal"))).toEqual([runner]);
    expect(entries.filter(hasGenerativeTransform())).toEqual([direct]);
    expect(entries.filter(hasCollection())).toEqual([runner]);
    expect(entries.filter(hasLoop())).toEqual([direct]);
  });

  it("match transformation thresholds", () => {
    expect(entries.filter(minTransforms(3))).toEqual([direct]);
  });

  it("match free text across metadata and structure", () => {
    expect(entries.filter(matchesText("runner formal"))).toEqual([runner]);
    expect(entries.filter(matchesText("model_1"))).toEqual([runner]);
  });
});

describe("filterEntries", () => {
  it("returns everything for the empty query", () => {
    expect(filterEntries(entries, emptyQuery)).toEqual(entries);
    expect(isQueryActive(emptyQuery)).toBe(false);
  });

  it("composes constraints with AND semantics", () => {
    const query = { ...emptyQuery, actorOperations: ["human modify", "model generate"] };
    expect(filterEntries(entries, query)).toEqual([direct]);
    expect(filterEntries(entries, { ...query, actors: ["tool"] })).toEqual([]);
  });

  it("filters by dimension ranges, years, and venues", () => {
    expect(filterEntries(entries, { ...emptyQuery, ranges: { modelTransformCount: { min: 1, max: 1 } } })).toHaveLength(2);
    expect(filterEntries(entries, { ...emptyQuery, ranges: { humanTransformCount: { min: 2 } } })).toEqual([direct]);
    expect(filterEntries(entries, { ...emptyQuery, year: { max: 2022 } })).toEqual([runner]);
    expect(filterEntries(entries, { ...emptyQuery, venues: ["CHI", "UIST"] })).toHaveLength(2);
  });
});
