// Process 6 — Accumulate domain knowledge. model_9 extract~ (Summary Agent) → model_10 modify (Memory Management Agent).
import { z } from 'zod';
import { callModelJson } from './llm.js';
import { formatLogs } from './logs.js';

const fmtKB = (kb) => kb.entries.map((e, i) => `${i}. ${e.concept}: ${e.meaning} (evidence: ${e.evidence}; source: ${e.source})`).join('\n') || '(empty)';

/** model_9 extract~ → task_summary */
export async function summarizeTask(task, kb) {
  const v = await callModelJson({
    system: 'You are the Summary Agent. You distil what an annotation task established about cultural and semantic meanings: which motifs carried which meanings, under what conditions, and which readings were rejected.',
    prompt: `Task: ${task.instruction}\n\nConfirmed labels:\n${Object.entries(task.confirmed).map(([k, v]) => `${k}: [${v.labels.join(', ')}]`).join('\n') || '(none)'}\n\nInteraction log:\n${formatLogs(task.logs)}\n\nCurrent knowledge base:\n${fmtKB(kb)}\n\nWrite a concise summary (≤150 words) of the knowledge gained in this task, emphasising what is new relative to the knowledge base.\nJSON: {"summary":"..."}`,
    schema: z.object({ summary: z.string().min(20) }),
  });
  return v.summary;
}

/** model_10 modify → knowledge_base_2 */
export async function integrateKnowledge(summary, kb, sourceTask) {
  const v = await callModelJson({
    system: 'You are the Memory Management Agent. You integrate newly acquired cultural and semantic knowledge into a knowledge base of concept → meaning entries, avoiding duplicates and refining existing entries when the new evidence qualifies them.',
    prompt: `Task summary:\n${summary}\n\nKnowledge base (indexed):\n${fmtKB(kb)}\n\nReturn additions and updates.\nJSON: {"add":[{"concept":"...","meaning":"...","evidence":"..."}],"update":[{"index":0,"meaning":"...","evidence":"..."}]}`,
    schema: z.object({
      add: z.array(z.object({ concept: z.string(), meaning: z.string(), evidence: z.string() })).default([]),
      update: z.array(z.object({ index: z.number().int(), meaning: z.string(), evidence: z.string() })).default([]),
    }),
    check: (x) => { const bad = x.update.filter((u) => !kb.entries[u.index]); return bad.length ? `update index out of range: ${bad.map((b) => b.index).join(', ')}` : null; },
  });
  const entries = kb.entries.map((e) => ({ ...e }));
  for (const u of v.update) entries[u.index] = { ...entries[u.index], meaning: u.meaning, evidence: u.evidence, source: sourceTask };
  for (const a of v.add) {
    const dup = entries.findIndex((e) => e.concept.toLowerCase() === a.concept.toLowerCase());
    if (dup >= 0) entries[dup] = { ...entries[dup], meaning: a.meaning, evidence: a.evidence, source: sourceTask };
    else entries.push({ ...a, source: sourceTask });
  }
  return { entries, added: v.add.length, updated: v.update.length };
}
