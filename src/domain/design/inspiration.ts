import { extractFeatures } from "../grammar/features";
import { formatProcess, formatState, formatTransform, formatType } from "../grammar/formatter";
import { parseProcess, parseState } from "../grammar/parser";
import { jaccard, similarity, type SimilarityResult } from "../grammar/similarity";
import type { Process, Representation, State, Transform } from "../grammar/types";
import type { SystemEntry } from "../systems/types";

export interface Step {
  entry: SystemEntry;
  processName: string | null;
  before: State;
  transform: Transform;
  after: State;
}

export interface SimilarSystem {
  entry: SystemEntry;
  similarity: SimilarityResult;
}

const representationTypes = (state: State) => state.representations.map(formatType);

const baseName = (id: string) => id.replace(/_\d+$/, "");

const nextVersion = (id: string) => `${baseName(id)}_${Number(/_(\d+)$/.exec(id)?.[1] ?? 0) + 1}`;

const representationNames = (state: State) => state.representations.map(({ id }) => baseName(id));

export const stepProcess = (step: Step): Process => ({ states: [step.before, step.after], transforms: [step.transform] });

export const stepText = (step: Step) => formatProcess(stepProcess(step), " ");

const signature = (step: Step) => {
  const transform = formatTransform({ ...step.transform, actorInstance: undefined });
  return [representationTypes(step.before).join("+"), transform, representationTypes(step.after).join("+")].join("|");
};

export function corpusSteps(entries: SystemEntry[]): Step[] {
  return entries.flatMap((entry) =>
    entry.processes.flatMap(({ name, result }) =>
      result.ok
        ? result.process.transforms.map((transform, index) => ({
            entry,
            processName: name,
            before: result.process.states[index],
            transform,
            after: result.process.states[index + 1],
          }))
        : [],
    ),
  );
}

function distinct(steps: Step[], key: (step: Step) => string): Step[] {
  const seen = new Set<string>();
  return steps.filter((step) => {
    const value = key(step);
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

const searchableText = (step: Step) =>
  [
    stepText(step),
    step.transform.generative ? "generative" : "",
    step.processName,
    step.entry.name,
    step.entry.description,
    step.entry.paper.title,
    ...step.entry.paper.tags,
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();

export function searchSteps(entries: SystemEntry[], query: string, limit = 20): Step[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  const matches = corpusSteps(entries).filter((step) => {
    const text = searchableText(step);
    return terms.every((term) => text.includes(term));
  });
  return distinct(matches, (step) => `${step.entry.id}:${signature(step)}`).slice(0, limit);
}

export function nextSteps(entries: SystemEntry[], state: State, limit = 5): Step[] {
  const types = representationTypes(state);
  const names = representationNames(state);
  const ranked = corpusSteps(entries)
    .map((step) => ({
      step,
      types: jaccard(types, representationTypes(step.before)),
      names: jaccard(names, representationNames(step.before)),
    }))
    .filter(({ types }) => types > 0)
    .sort((a, b) => b.types - a.types || b.names - a.names);
  return distinct(
    ranked.map(({ step }) => step),
    signature,
  ).slice(0, limit);
}

export function similarSystems(entries: SystemEntry[], processes: Process[], limit = 5): SimilarSystem[] {
  if (processes.length === 0) return [];
  const features = extractFeatures(processes);
  return entries
    .map((entry) => ({ entry, similarity: similarity(features, entry.features) }))
    .sort((a, b) => b.similarity.overall - a.similarity.overall)
    .slice(0, limit);
}

export interface Recommendation {
  transform: Transform;
  after: State;
  produced: Representation[];
  systems: number;
}

export function adaptStep(step: Step, state: State): State {
  const taken = new Set(state.representations.map(({ id }) => id));
  const used = new Set<string>();
  const fresh = (id: string) => {
    let candidate = id;
    while (taken.has(candidate)) candidate = nextVersion(candidate);
    taken.add(candidate);
    return candidate;
  };
  const representations = step.after.representations.flatMap((representation): Representation[] => {
    const source =
      step.before.representations.find(({ id }) => id === representation.id) ??
      step.before.representations.find(({ id }) => baseName(id) === baseName(representation.id));
    if (!source) return [{ ...representation, id: fresh(`${baseName(representation.id)}_1`) }];
    const mine = state.representations.find((candidate) => formatType(candidate) === formatType(source) && !used.has(candidate.id));
    if (!mine) return [];
    used.add(mine.id);
    return [source.id === representation.id ? mine : { ...representation, id: fresh(nextVersion(mine.id)) }];
  });
  return { representations };
}

export function recommend(entries: SystemEntry[], state: State, limit = 4): Recommendation[] {
  const types = representationTypes(state);
  const groups = new Map<string, Recommendation & { score: number; ids: Set<number> }>();
  for (const step of corpusSteps(entries)) {
    const score = jaccard(types, representationTypes(step.before));
    const after = adaptStep(step, state);
    const produced = after.representations.filter((representation) => !state.representations.includes(representation));
    if (score === 0 || produced.length === 0) continue;
    const transform = { ...step.transform, actorInstance: undefined };
    const key = `${formatTransform(transform)}|${produced.map(formatType).join("+")}`;
    const group = groups.get(key) ?? { transform, after, produced, systems: 0, score: 0, ids: new Set<number>() };
    group.score += score;
    group.ids.add(step.entry.id);
    groups.set(key, group);
  }
  return [...groups.values()]
    .sort((a, b) => b.ids.size - a.ids.size || b.score - a.score)
    .slice(0, limit)
    .map(({ transform, after, produced, ids }) => ({ transform, after, produced, systems: ids.size }));
}

export function appendTransition(rawExpression: string, transform: Transform, after: State): string {
  return `${rawExpression.trimEnd()}\n-> ${formatTransform(transform)}\n-> ${formatState(after)}`;
}

export function lastStateOf(rawExpression: string): State | null {
  const result = parseProcess(rawExpression);
  return result.ok ? result.process.states[result.process.states.length - 1] : parseState(rawExpression);
}
