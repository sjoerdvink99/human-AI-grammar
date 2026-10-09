import { describe, expect, it } from "vitest";
import { kMeans, normalize } from "./clustering";

describe("normalize", () => {
  it("scales each dimension to [0, 1] and zeroes constant dimensions", () => {
    expect(normalize([[0, 5], [10, 5], [5, 5]])).toEqual([[0, 0], [1, 0], [0.5, 0]]);
  });
});

describe("kMeans", () => {
  const points = [[0, 0], [0.1, 0], [0, 0.1], [1, 1], [0.9, 1], [1, 0.9]];

  it("separates well-separated groups deterministically", () => {
    const assignments = kMeans(points, 2);
    expect(assignments).toEqual(kMeans(points, 2));
    expect(new Set(assignments.slice(0, 3)).size).toBe(1);
    expect(new Set(assignments.slice(3)).size).toBe(1);
    expect(assignments[0]).not.toBe(assignments[3]);
  });

  it("caps k at the number of points", () => {
    expect(new Set(kMeans(points.slice(0, 2), 5)).size).toBeLessThanOrEqual(2);
    expect(kMeans([], 3)).toEqual([]);
  });
});
