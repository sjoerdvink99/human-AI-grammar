import { diffLines } from "diff";
import type { CodeDiff, DiffHunk, FileKey, WebCode } from "./types.ts";
import { FILE_KEYS } from "./types.ts";

const CONTEXT = 2;

function splitLines(value: string): string[] {
  const lines = value.split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** A change block: unchanged text, or a removed/added replacement. */
type Block = { kind: "same"; lines: string[] } | { kind: "change"; removed: string[]; added: string[] };

function blocks(a: string, b: string): Block[] {
  const out: Block[] = [];
  for (const part of diffLines(a, b)) {
    const lines = splitLines(part.value);
    if (!part.added && !part.removed) {
      out.push({ kind: "same", lines });
      continue;
    }
    let last = out[out.length - 1];
    if (!last || last.kind !== "change") {
      last = { kind: "change", removed: [], added: [] };
      out.push(last);
    }
    if (part.removed) last.removed.push(...lines);
    else last.added.push(...lines);
  }
  return out;
}

/** tool_5 extract: diff_1 from code_1 and code_2. */
export function extractDiff(code1: WebCode, code2: WebCode): CodeDiff {
  const hunks: DiffHunk[] = [];
  for (const file of FILE_KEYS) {
    const bs = blocks(normalize(code1[file]), normalize(code2[file]));
    let oldLine = 1;
    bs.forEach((b, i) => {
      if (b.kind === "same") {
        oldLine += b.lines.length;
        return;
      }
      const prev = bs[i - 1];
      const next = bs[i + 1];
      hunks.push({
        id: `${file}-${hunks.filter((h) => h.file === file).length}`,
        file,
        oldStart: oldLine,
        removed: b.removed,
        added: b.added,
        contextBefore: prev && prev.kind === "same" ? prev.lines.slice(-CONTEXT) : [],
        contextAfter: next && next.kind === "same" ? next.lines.slice(0, CONTEXT) : [],
      });
      oldLine += b.removed.length;
    });
  }
  return { hunks };
}

/** tool_5 modify: apply only the selected hunks of diff_1 to code_1, giving code_3. */
export function applySelected(code1: WebCode, code2: WebCode, selected: Iterable<string>): WebCode {
  const chosen = new Set(selected);
  const result = { ...code1 };
  for (const file of FILE_KEYS) {
    const bs = blocks(normalize(code1[file]), normalize(code2[file]));
    const out: string[] = [];
    let n = 0;
    for (const b of bs) {
      if (b.kind === "same") out.push(...b.lines);
      else out.push(...(chosen.has(`${file}-${n++}`) ? b.added : b.removed));
    }
    result[file as FileKey] = out.join("\n") + (out.length ? "\n" : "");
  }
  return result;
}

function normalize(s: string): string {
  const t = s.replace(/\r\n/g, "\n");
  return t.endsWith("\n") || t === "" ? t : t + "\n";
}
