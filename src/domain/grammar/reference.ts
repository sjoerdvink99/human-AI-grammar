import { suggestedVocabulary } from "./vocabulary";

export interface GrammarRule {
  symbol: string;
  definition: string;
}

const openVocabulary = (terms: string[]) => `${terms.map((term) => `"${term}"`).join(" | ")} | …`;

export const grammarRules: GrammarRule[] = [
  { symbol: "process", definition: "state (transform state)+" },
  { symbol: "state", definition: 'rep ("+" rep)*' },
  { symbol: "rep", definition: 'id ":" role medium' },
  { symbol: "transform", definition: "actor op" },
  { symbol: "actor", definition: '"human" | "model" | "tool"' },
  { symbol: "role", definition: openVocabulary(suggestedVocabulary.role) },
  { symbol: "medium", definition: openVocabulary(suggestedVocabulary.medium) },
  { symbol: "op", definition: openVocabulary(suggestedVocabulary.operation) },
];
