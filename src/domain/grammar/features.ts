import { actorKinds, type ActorKind, type Process, type State } from "./types";

export type Counts = Record<string, number>;

export interface StructuralFeatures {
  processCount: number;
  stateCount: number;
  representationCount: number;
  transformCount: number;
  humanTransformCount: number;
  modelTransformCount: number;
  toolTransformCount: number;
  generativeTransformCount: number;
  collectionCount: number;
  loopCount: number;
  uniqueRoles: number;
  uniqueMedia: number;
  uniqueOperations: number;
  roles: Counts;
  media: Counts;
  operations: Counts;
  actors: Record<ActorKind, number>;
  representationTypes: Counts;
  actorOperationPairs: Counts;
  handoffs: Counts;
  stateSizes: number[];
  processLengths: number[];
}

export const pairKey = (first: string, second: string) => `${first} ${second}`;

export const handoffKey = (from: ActorKind, to: ActorKind) => `${from} → ${to}`;

const stateKey = (state: State) => state.representations.map(({ id }) => id).sort().join(" ");

export function loops(process: Process): { step: number; to: number }[] {
  const keys = process.states.map(stateKey);
  return process.transforms.flatMap((_, step) => {
    const to = keys.slice(0, step).indexOf(keys[step + 1]);
    return to >= 0 && keys[step + 1] !== keys[step] ? [{ step, to }] : [];
  });
}

function increment(counts: Counts, key: string) {
  counts[key] = (counts[key] ?? 0) + 1;
}

export function extractFeatures(processes: Process[]): StructuralFeatures {
  const roles: Counts = {};
  const media: Counts = {};
  const operations: Counts = {};
  const representationTypes: Counts = {};
  const actorOperationPairs: Counts = {};
  const handoffs: Counts = {};
  const actors = Object.fromEntries(actorKinds.map((kind) => [kind, 0])) as Record<ActorKind, number>;
  const seen = new Set<string>();
  const collections = new Set<string>();
  const states = processes.flatMap((process) => process.states);
  const transforms = processes.flatMap((process) => process.transforms);

  for (const representation of states.flatMap((state) => state.representations)) {
    const key = `${representation.id}\u0000${representation.role}\u0000${representation.medium}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (representation.collection) collections.add(key);
    increment(roles, representation.role);
    increment(media, representation.medium);
    increment(representationTypes, pairKey(representation.role, representation.medium));
  }

  transforms.forEach((transform, index) => {
    actors[transform.actor] += 1;
    increment(operations, transform.operation);
    increment(actorOperationPairs, pairKey(transform.actor, transform.operation));
    const previous = transforms[index - 1];
    if (previous && previous.actor !== transform.actor) increment(handoffs, handoffKey(previous.actor, transform.actor));
  });

  return {
    processCount: processes.length,
    stateCount: states.length,
    representationCount: seen.size,
    transformCount: transforms.length,
    humanTransformCount: actors.human,
    modelTransformCount: actors.model,
    toolTransformCount: actors.tool,
    generativeTransformCount: transforms.filter((transform) => transform.generative).length,
    collectionCount: collections.size,
    loopCount: processes.reduce((sum, process) => sum + loops(process).length, 0),
    uniqueRoles: Object.keys(roles).length,
    uniqueMedia: Object.keys(media).length,
    uniqueOperations: Object.keys(operations).length,
    roles,
    media,
    operations,
    actors,
    representationTypes,
    actorOperationPairs,
    handoffs,
    stateSizes: states.map((state) => state.representations.length),
    processLengths: processes.map((process) => process.transforms.length),
  };
}
