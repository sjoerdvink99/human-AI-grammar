// Process 6: interaction_logs_2 + confirmed_labels_2 + knowledge_base_1
//   -> [model_9 extract]~ task_summary_1 -> [model_10 modify] knowledge_base_2
import { callModel } from '../llm.js';

export async function model9Summarize(logs, confirmedLabels, kb, taxonomy) {
  const name = (id) => taxonomy.nodes.find((n) => n.id === id)?.label || id;
  const counts = {};
  confirmedLabels.forEach((c) => { counts[c.labelId] = (counts[c.labelId] || 0) + 1; });
  const out = await callModel({
    role: 'model_9',
    system: 'You are model_9. You summarise an annotation session: the task, what the curator decided, which AI recommendations were corrected and why, and any general rules the curator applied.',
    schema: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] },
    prompt: `Knowledge base before this session:
${kb.entries.map((e) => `- (${e.id}) ${e.topic}: ${e.content}`).join('\n')}

Confirmed labels (counts): ${Object.entries(counts).map(([k, v]) => `${name(k)} ×${v}`).join(', ') || '(none)'}

Interaction logs:
${logs.map((l) => JSON.stringify(l)).join('\n')}

Write a summary of 5-10 sentences, highlighting decisions and rules that are not yet in the knowledge base.`,
  });
  return out.summary;
}

export async function model10UpdateKB(summary, kb) {
  const out = await callModel({
    role: 'model_10',
    system: 'You are model_10, the maintainer of a knowledge base of annotation conventions for artwork units. You make minimal, precise edits.',
    schema: { type: 'object', properties: { operations: { type: 'array', items: { type: 'object', properties: { op: { type: 'string', enum: ['add', 'update', 'remove'] }, id: { type: 'string' }, topic: { type: 'string' }, content: { type: 'string' }, reason: { type: 'string' } }, required: ['op', 'id', 'topic', 'content', 'reason'] } } }, required: ['operations'] },
    prompt: `Knowledge base:
${kb.entries.map((e) => `- (${e.id}) ${e.topic}: ${e.content}`).join('\n')}

Session summary:
${summary}

Return edit operations: add new conventions (id empty), update entries whose content the session refined (keep id), remove entries the session contradicted. Return no operations if nothing should change.`,
  });
  return applyKBOps(kb, out.operations);
}

/** Apply model_10's operations deterministically and keep a record of what changed. */
export function applyKBOps(kb, operations) {
  let entries = kb.entries.map((e) => ({ ...e }));
  const applied = [];
  let next = entries.reduce((m, e) => Math.max(m, Number(e.id.replace(/\D/g, '')) || 0), 0) + 1;
  for (const op of operations) {
    if (op.op === 'add') {
      const e = { id: `kb-${next++}`, topic: op.topic, content: op.content, source: 'learned' };
      entries.push(e);
      applied.push({ ...op, id: e.id });
    } else if (op.op === 'update' && entries.some((e) => e.id === op.id)) {
      entries = entries.map((e) => (e.id === op.id ? { ...e, topic: op.topic || e.topic, content: op.content, source: 'learned' } : e));
      applied.push(op);
    } else if (op.op === 'remove' && entries.some((e) => e.id === op.id)) {
      entries = entries.filter((e) => e.id !== op.id);
      applied.push(op);
    }
  }
  return { entries, operations: applied };
}
