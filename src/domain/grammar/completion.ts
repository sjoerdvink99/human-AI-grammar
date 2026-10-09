import { parseProcess } from "./parser";
import { actorKinds, type Process } from "./types";
import type { VocabularyType } from "./vocabulary";

export type CompletionKind = "identifier" | "actor" | VocabularyType;

export interface CompletionOption {
  value: string;
  detail?: string;
}

export interface Completion {
  kind: CompletionKind;
  from: number;
  to: number;
  options: CompletionOption[];
}

export interface CompletionSource {
  vocabulary: Record<VocabularyType, string[]>;
  identifiers: string[];
}

const suffixes: Record<CompletionKind, { text: string; closing?: string }> = {
  identifier: { text: ": " },
  role: { text: " " },
  medium: { text: ")", closing: ")" },
  actor: { text: " " },
  operation: { text: "]", closing: "]" },
};

const versioned = /^(.*)_(\d+)$/;

export function identifiersIn(text: string): string[] {
  return [...text.matchAll(/\(\s*([\p{L}\p{N}_-]+)\s*:/gu)].map((match) => match[1]);
}

function identifierOptions(identifiers: string[]): CompletionOption[] {
  const existing = [...new Set(identifiers)];
  const latest = new Map<string, number>();
  for (const id of existing) {
    const match = versioned.exec(id);
    if (match) latest.set(match[1], Math.max(latest.get(match[1]) ?? 0, Number(match[2])));
  }
  const next = [...latest].map(([base, version]) => `${base}_${version + 1}`).filter((id) => !existing.includes(id));
  return [
    ...existing.map((value) => ({ value, detail: "same" })),
    ...next.map((value) => ({ value, detail: "new version" })),
  ];
}

function context(before: string): { kind: CompletionKind } | null {
  const open = Math.max(before.lastIndexOf("("), before.lastIndexOf("["));
  const close = Math.max(before.lastIndexOf(")"), before.lastIndexOf("]"));
  if (open < 0 || close > open) return null;
  const inside = before.slice(open + 1);
  if (before[open] === "[") {
    const words = inside.split(/\s+/).filter(Boolean).length;
    return words === 0 ? { kind: "actor" } : words === 1 ? { kind: "operation" } : null;
  }
  const colon = inside.indexOf(":");
  if (colon < 0) return inside.trim() ? null : { kind: "identifier" };
  const words = inside.slice(colon + 1).split(/\s+/).filter(Boolean).length;
  return words === 0 ? { kind: "role" } : words === 1 ? { kind: "medium" } : null;
}

export function complete(text: string, caret: number, source: CompletionSource): Completion | null {
  const partial = /[\p{L}\p{N}_]*$/u.exec(text.slice(0, caret))?.[0] ?? "";
  const from = caret - partial.length;
  const found = context(text.slice(0, from));
  if (!found) return null;
  const { kind } = found;
  const candidates: CompletionOption[] =
    kind === "identifier"
      ? identifierOptions(source.identifiers)
      : kind === "actor"
        ? [...actorKinds, ...source.identifiers.filter((id) => /^(human|model|tool)_/.test(id))].map((value) => ({ value }))
        : source.vocabulary[kind].map((value) => ({ value }));
  const prefix = partial.toLowerCase();
  const options = candidates.filter(({ value }) => value.toLowerCase().startsWith(prefix) && value.toLowerCase() !== prefix);
  return options.length ? { kind, from, to: caret, options } : null;
}

export function applyCompletion(text: string, completion: Completion, value: string): { text: string; caret: number } {
  const { text: suffix, closing } = suffixes[completion.kind];
  const rest = text.slice(completion.to);
  const append = closing && rest.trimStart().startsWith(closing) ? "" : suffix;
  const inserted = value + append;
  return { text: text.slice(0, completion.from) + inserted + rest, caret: completion.from + inserted.length };
}

export function completePart(text: string): Process | null {
  const lines = text.split("\n");
  for (let count = lines.length; count > 0; count -= 1) {
    const result = parseProcess(lines.slice(0, count).join("\n"));
    if (result.ok) return result.process;
  }
  return null;
}
