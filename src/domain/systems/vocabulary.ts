import type { Counts } from "../grammar/features";
import type { VocabularyType } from "../grammar/vocabulary";
import type { SystemEntry } from "./types";

export interface VocabularyTerm {
  type: VocabularyType;
  term: string;
  systemCount: number;
  occurrenceCount: number;
}

const sources: Record<VocabularyType, (entry: SystemEntry) => Counts> = {
  role: (entry) => entry.features.roles,
  medium: (entry) => entry.features.media,
  operation: (entry) => entry.features.operations,
};

export function buildVocabulary(entries: SystemEntry[]): VocabularyTerm[] {
  const terms = new Map<string, VocabularyTerm>();
  for (const entry of entries) {
    for (const [type, select] of Object.entries(sources) as [VocabularyType, (entry: SystemEntry) => Counts][]) {
      for (const [term, count] of Object.entries(select(entry))) {
        const key = `${type}:${term}`;
        const current = terms.get(key) ?? { type, term, systemCount: 0, occurrenceCount: 0 };
        terms.set(key, { ...current, systemCount: current.systemCount + 1, occurrenceCount: current.occurrenceCount + count });
      }
    }
  }
  return [...terms.values()].sort((a, b) => b.systemCount - a.systemCount || a.term.localeCompare(b.term));
}

export function termsOfType(vocabulary: VocabularyTerm[], type: VocabularyType): string[] {
  return vocabulary.filter((term) => term.type === type).map((term) => term.term);
}
