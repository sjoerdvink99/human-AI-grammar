import { actorKinds } from "../grammar/types";
import type { SystemEntry } from "./types";

export interface FacetValue {
  value: string;
  count: number;
}

export interface Facets {
  actors: FacetValue[];
  operations: FacetValue[];
  roles: FacetValue[];
  media: FacetValue[];
  representationTypes: FacetValue[];
  actorOperations: FacetValue[];
  venues: FacetValue[];
  scopes: FacetValue[];
}

function facet(entries: SystemEntry[], values: (entry: SystemEntry) => string[]): FacetValue[] {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    for (const value of new Set(values(entry))) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts].map(([value, count]) => ({ value, count })).sort((a, b) => a.value.localeCompare(b.value));
}

export function buildFacets(entries: SystemEntry[]): Facets {
  return {
    actors: facet(entries, (entry) => actorKinds.filter((kind) => entry.features.actors[kind] > 0)),
    operations: facet(entries, (entry) => Object.keys(entry.features.operations)),
    roles: facet(entries, (entry) => Object.keys(entry.features.roles)),
    media: facet(entries, (entry) => Object.keys(entry.features.media)),
    representationTypes: facet(entries, (entry) => Object.keys(entry.features.representationTypes)),
    actorOperations: facet(entries, (entry) => Object.keys(entry.features.actorOperationPairs)),
    venues: facet(entries, (entry) => [entry.paper.venue]),
    scopes: facet(entries, (entry) => (entry.processScope ? [entry.processScope] : [])),
  };
}
