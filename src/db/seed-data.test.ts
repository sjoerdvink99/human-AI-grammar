import { describe, expect, it } from "vitest";
import { buildEntry } from "@/domain/systems/corpus";
import { systemInputSchema } from "@/domain/systems/schema";
import { seedSystems } from "./seed-data";

describe("seed data", () => {
  it.each(seedSystems.map((record) => [record.system.name, record] as const))("%s validates and parses", (_, record) => {
    const result = systemInputSchema.safeParse(record);
    expect(result.error?.issues ?? []).toEqual([]);
  });

  it("covers distinct structural patterns", () => {
    const now = new Date(0);
    const entries = seedSystems.map((record, id) =>
      buildEntry({
        id,
        name: record.system.name,
        description: "",
        processScope: null,
        notes: null,
        paper: { ...record.paper, id, doi: null, url: null, abstract: null, notes: null, tags: [], createdAt: now, updatedAt: now },
        processes: record.processes.map((process, order) => ({ id: order, name: null, description: process.description, rawExpression: process.rawExpression, order })),
      }),
    );
    expect(new Set(entries.map((entry) => entry.features.transformCount)).size).toBeGreaterThan(2);
    expect(entries.every((entry) => entry.processes.every((process) => process.result.ok))).toBe(true);
  });
});
