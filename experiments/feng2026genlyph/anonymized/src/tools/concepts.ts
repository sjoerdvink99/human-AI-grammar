/** tool_1 extract: r4 (brainstorm prose) -> r5* (concept phrases) */
export function parseConcepts(r4: string): string[] {
  const items = r4
    .split(/\r?\n/)
    .map((l) => l.match(/^\s*(?:\d+[.)]|[-*•])\s+(.+)$/)?.[1]?.trim())
    .filter((l): l is string => !!l && l.length > 3)
    .map((l) => l.replace(/\*\*/g, ""));
  return [...new Set(items)].slice(0, 8);
}

export function conceptTitle(concept: string): string {
  return concept.split(/\s+[—–-]\s+/)[0];
}
