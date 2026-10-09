// tool_5 extract: line-level edit blocks between code_1 and code_2.
// tool_5 modify: apply only the edits the human selected, giving code_3.
import { diffLines } from 'diff';

/**
 * Split the diff into alternating unchanged segments and edit blocks.
 * @returns {{ segments: Array<{type:'same', text:string} | {type:'edit', id:string, removed:string, added:string, line:number}> }}
 */
export function extractEdits(code1, code2) {
  const parts = diffLines(code1, code2);
  const segments = [];
  let line = 1;
  let n = 0;
  let open = null;
  for (const part of parts) {
    if (!part.added && !part.removed) {
      open = null;
      segments.push({ type: 'same', text: part.value });
      line += part.count;
      continue;
    }
    if (!open) {
      open = { type: 'edit', id: `e${++n}`, removed: '', added: '', line };
      segments.push(open);
    }
    if (part.removed) {
      open.removed += part.value;
      line += part.count;
    } else open.added += part.value;
  }
  return { segments };
}

/** The diff_1 representation sent to the UI: edits with a little surrounding context. */
export function diffForUi(code1, code2, contextLines = 2) {
  const { segments } = extractEdits(code1, code2);
  return segments
    .map((s, i) => {
      if (s.type !== 'edit') return null;
      const prev = segments[i - 1]?.type === 'same' ? tailLines(segments[i - 1].text, contextLines) : '';
      const next = segments[i + 1]?.type === 'same' ? headLines(segments[i + 1].text, contextLines) : '';
      return { id: s.id, line: s.line, removed: s.removed, added: s.added, before: prev, after: next };
    })
    .filter(Boolean);
}

/** tool_5 modify: code_3 = code_1 with only the selected edits applied. */
export function applyEdits(code1, code2, selectedIds) {
  const keep = new Set(selectedIds);
  return extractEdits(code1, code2)
    .segments.map((s) => (s.type === 'same' ? s.text : keep.has(s.id) ? s.added : s.removed))
    .join('');
}

const lines = (t) => t.replace(/\n$/, '').split('\n');
const tailLines = (t, n) => lines(t).slice(-n).join('\n');
const headLines = (t, n) => lines(t).slice(0, n).join('\n');
