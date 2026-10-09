import { pairKey } from "../grammar/features";
import { actorKinds, type ActorKind } from "../grammar/types";
import { findDimension } from "./dimensions";
import type { SystemEntry } from "./types";

export type Predicate = (entry: SystemEntry) => boolean;

export interface Range {
  min?: number;
  max?: number;
}

export interface SystemQuery {
  text: string;
  actors: string[];
  operations: string[];
  roles: string[];
  media: string[];
  representationTypes: string[];
  actorOperations: string[];
  venues: string[];
  scopes: string[];
  generative: boolean;
  collections: boolean;
  loops: boolean;
  year: Range;
  ranges: Record<string, Range>;
}

export const emptyQuery: SystemQuery = {
  text: "",
  actors: [],
  operations: [],
  roles: [],
  media: [],
  representationTypes: [],
  actorOperations: [],
  venues: [],
  scopes: [],
  generative: false,
  collections: false,
  loops: false,
  year: {},
  ranges: {},
};

const isActor = (value: string): value is ActorKind => (actorKinds as readonly string[]).includes(value);

const isBounded = ({ min, max }: Range) => min !== undefined || max !== undefined;

const within = (value: number, { min, max }: Range) =>
  (min === undefined || value >= min) && (max === undefined || value <= max);

export const hasActor = (actor: string): Predicate => (entry) => isActor(actor) && entry.features.actors[actor] > 0;

export const hasOperation = (operation: string): Predicate => (entry) => operation in entry.features.operations;

export const hasRole = (role: string): Predicate => (entry) => role in entry.features.roles;

export const hasMedium = (medium: string): Predicate => (entry) => medium in entry.features.media;

export const hasRepresentationType =
  (role: string, medium: string): Predicate =>
  (entry) =>
    pairKey(role, medium) in entry.features.representationTypes;

export const hasActorOperation =
  (actor: string, operation: string): Predicate =>
  (entry) =>
    pairKey(actor, operation) in entry.features.actorOperationPairs;

export const hasGenerativeTransform = (): Predicate => (entry) => entry.features.generativeTransformCount > 0;

export const hasCollection = (): Predicate => (entry) => entry.features.collectionCount > 0;

export const hasLoop = (): Predicate => (entry) => entry.features.loopCount > 0;

export const inDimensionRange =
  (key: string, range: Range): Predicate =>
  (entry) => {
    const dimension = findDimension(key);
    return !dimension || within(dimension.value(entry.features), range);
  };

export const minTransforms = (min: number) => inDimensionRange("transformCount", { min });

export const inYearRange = (range: Range): Predicate => (entry) => within(entry.paper.year, range);

export const inVenues = (venues: string[]): Predicate => (entry) => venues.includes(entry.paper.venue);

export const inScopes = (scopes: string[]): Predicate => (entry) => scopes.includes(entry.processScope ?? "");

export const matchesText =
  (text: string): Predicate =>
  (entry) =>
    text
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
      .every((term) => entry.searchText.includes(term));

const splitPair = (value: string): [string, string] => {
  const [first = "", second = ""] = value.split(" ");
  return [first, second];
};

export function queryPredicates(query: SystemQuery): Predicate[] {
  return [
    ...(query.text.trim() ? [matchesText(query.text)] : []),
    ...query.actors.map(hasActor),
    ...query.operations.map(hasOperation),
    ...query.roles.map(hasRole),
    ...query.media.map(hasMedium),
    ...query.representationTypes.map((value) => hasRepresentationType(...splitPair(value))),
    ...query.actorOperations.map((value) => hasActorOperation(...splitPair(value))),
    ...(query.venues.length ? [inVenues(query.venues)] : []),
    ...(query.scopes.length ? [inScopes(query.scopes)] : []),
    ...(query.generative ? [hasGenerativeTransform()] : []),
    ...(query.collections ? [hasCollection()] : []),
    ...(query.loops ? [hasLoop()] : []),
    ...(isBounded(query.year) ? [inYearRange(query.year)] : []),
    ...Object.entries(query.ranges)
      .filter(([, range]) => isBounded(range))
      .map(([key, range]) => inDimensionRange(key, range)),
  ];
}

export function filterEntries(entries: SystemEntry[], query: SystemQuery): SystemEntry[] {
  const predicates = queryPredicates(query);
  return entries.filter((entry) => predicates.every((predicate) => predicate(entry)));
}

export function isQueryActive(query: SystemQuery): boolean {
  return queryPredicates(query).length > 0;
}
