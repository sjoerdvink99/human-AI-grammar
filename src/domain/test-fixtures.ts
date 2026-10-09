import { parseProcess } from "./grammar/parser";
import type { Process } from "./grammar/types";
import { buildEntry } from "./systems/corpus";
import type { SystemEntry } from "./systems/types";

export function parseAll(...expressions: string[]): Process[] {
  return expressions.map((expression) => {
    const result = parseProcess(expression);
    if (!result.ok) throw new Error(result.error.message);
    return result.process;
  });
}

export function entry(id: number, name: string, expressions: string[], overrides: { year?: number; venue?: string } = {}): SystemEntry {
  const now = new Date(0);
  return buildEntry({
    id,
    name,
    description: "",
    processScope: null,
    notes: null,
    actors: {},
    paper: {
      id,
      title: `${name} paper`,
      authors: ["Ada Lovelace"],
      year: overrides.year ?? 2024,
      venue: overrides.venue ?? "CHI",
      citationKey: name.toLowerCase(),
      doi: null,
      url: null,
      abstract: null,
      notes: null,
      tags: [],
      createdAt: now,
      updatedAt: now,
    },
    processes: expressions.map((rawExpression, order) => ({ id: order, name: null, description: "Lorem ipsum dolor sit amet.", rawExpression, order })),
  });
}
