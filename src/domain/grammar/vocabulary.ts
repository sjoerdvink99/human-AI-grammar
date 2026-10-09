export const vocabularyTypes = ["role", "medium", "operation"] as const;

export type VocabularyType = (typeof vocabularyTypes)[number];

export const suggestedVocabulary: Record<VocabularyType, string[]> = {
  role: ["instruction", "artifact", "selection", "label", "evaluation"],
  medium: ["language", "visual", "spatial", "structured", "formal", "audio"],
  operation: [
    "generate",
    "modify",
    "select",
    "specify",
    "translate",
    "expand",
    "extract",
    "decompose",
    "compose",
    "match",
    "evaluate",
    "execute",
    "delegate",
    "assign",
    "configure",
  ],
};
