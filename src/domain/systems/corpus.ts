import { extractFeatures } from "../grammar/features";
import { parseProcess } from "../grammar/parser";
import type { Process } from "../grammar/types";
import type { SystemInput, SystemInputJson } from "./schema";
import type { SystemEntry, SystemRecord } from "./types";

export function buildEntry(record: SystemRecord): SystemEntry {
  const processes = [...record.processes]
    .sort((a, b) => a.order - b.order)
    .map((process) => ({ ...process, result: parseProcess(process.rawExpression) }));
  const parsed = processes.flatMap(({ result }): Process[] => (result.ok ? [result.process] : []));
  const features = extractFeatures(parsed);
  const searchText = [
    record.name,
    record.description,
    record.processScope,
    record.paper.title,
    record.paper.venue,
    ...record.paper.authors,
    ...record.paper.tags,
    ...processes.flatMap((process) => [process.description, process.rawExpression]),
    ...Object.keys(features.roles),
    ...Object.keys(features.media),
    ...Object.keys(features.operations),
    ...Object.keys(features.actorOperationPairs),
    ...parsed.flatMap((process) => process.transforms.map((transform) => transform.actorInstance ?? transform.actor)),
    ...Object.values(record.actors).flatMap((details) => Object.values(details)),
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();

  return { ...record, processes, features, searchText };
}

const orUndefined = <T>(value: T | null) => value ?? undefined;

export function recordToInput(record: SystemRecord): SystemInputJson {
  const { paper } = record;
  return {
    paper: {
      title: paper.title,
      authors: paper.authors,
      year: paper.year,
      venue: paper.venue,
      citationKey: paper.citationKey,
      doi: orUndefined(paper.doi),
      url: orUndefined(paper.url),
      abstract: orUndefined(paper.abstract),
      notes: orUndefined(paper.notes),
      tags: paper.tags,
    },
    system: {
      name: record.name,
      description: record.description,
      processScope: orUndefined(record.processScope),
      notes: orUndefined(record.notes),
      ...(Object.keys(record.actors).length > 0 && { actors: record.actors }),
    },
    processes: [...record.processes]
      .sort((a, b) => a.order - b.order)
      .map((process) => ({
        name: orUndefined(process.name),
        description: process.description,
        rawExpression: process.rawExpression,
      })),
  };
}

export function recordFromInput(input: SystemInput, id: number): SystemRecord {
  const now = new Date(0);
  const { paper, system } = input;
  return {
    id,
    name: system.name,
    description: system.description,
    processScope: system.processScope ?? null,
    notes: system.notes ?? null,
    actors: system.actors,
    paper: {
      id,
      ...paper,
      doi: paper.doi ?? null,
      url: paper.url ?? null,
      abstract: paper.abstract ?? null,
      notes: paper.notes ?? null,
      createdAt: now,
      updatedAt: now,
    },
    processes: input.processes.map((process, order) => ({
      id: order,
      name: process.name ?? null,
      description: process.description,
      rawExpression: process.rawExpression,
      order,
    })),
  };
}
