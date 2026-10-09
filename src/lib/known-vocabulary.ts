import { suggestedVocabulary, vocabularyTypes } from "@/domain/grammar/vocabulary";
import { buildVocabulary, termsOfType } from "@/domain/systems/vocabulary";
import { loadEntries } from "./repository";

export function loadKnownVocabulary() {
  const vocabulary = buildVocabulary(loadEntries());
  return Object.fromEntries(
    vocabularyTypes.map((type) => [type, [...new Set([...suggestedVocabulary[type], ...termsOfType(vocabulary, type)])]]),
  ) as Record<(typeof vocabularyTypes)[number], string[]>;
}
