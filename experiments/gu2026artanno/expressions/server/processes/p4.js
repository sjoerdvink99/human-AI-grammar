// Process 4: [human select] chat_focus -> [human specify] question -> [model_5 generate]~ chat_answer
//            -> [human evaluate] chat_decision -> [human assign] confirmed_labels_2 -> [tool_4 expand] interaction_logs_2
import { callModel } from '../llm.js';
import { load, save, getRun, newId } from '../store.js';
import { contactSheet } from '../tools/images.js';
import { tool4ExpandLogs } from '../tools/logs.js';

const SYSTEM_5 = `You are model_5, a conversational assistant helping a curator label units in artworks.
Answer the curator's question about the focused cluster or unit, grounded in the contact sheet image,
the cluster assignments, the recommended labels, the labels already confirmed and the interaction log.
If the answer implies a label change, propose exactly one label id (from the label list given) and the
unit ids it should apply to; otherwise return suggestedLabelId as an empty string and an empty unitIds list.`;

export async function model5Answer({ focus, question, run, s }) {
  const clusters = run.clusters;
  const focusUnits = focus.type === 'cluster'
    ? clusters.find((c) => c.id === focus.id)?.unitIds || []
    : [focus.id];
  const boxes = focusUnits.map((id) => s.boundingBoxes.find((b) => b.unitId === id)).filter(Boolean);
  const sheet = await contactSheet([{ caption: `Focus: ${focus.type} ${focus.id}`, units: boxes }], s.artworks, `chat-${Date.now()}`, Math.min(10, Math.max(1, boxes.length)));
  const nodes = s.labelTaxonomy.nodes;
  const allowed = new Set(nodes.map((n) => n.id));
  const confirmedHere = s.confirmedLabels.filter((c) => focusUnits.includes(c.unitId));
  const recentLogs = s.interactionLogs.slice(-15).map((l) => JSON.stringify(l)).join('\n');
  const out = await callModel({
    role: 'model_5', system: SYSTEM_5, images: [sheet],
    schema: { type: 'object', properties: { answer: { type: 'string' }, suggestedLabelId: { type: 'string' }, unitIds: { type: 'array', items: { type: 'string' } } }, required: ['answer', 'suggestedLabelId', 'unitIds'] },
    validate: (o) => (o.suggestedLabelId && !allowed.has(o.suggestedLabelId) ? `unknown label id ${o.suggestedLabelId}` : null),
    prompt: `Focus: ${focus.type} ${focus.id} (units: ${focusUnits.join(', ')})

Clusters and recommended labels:
${clusters.map((c) => `- ${c.id} "${c.name}" (${c.unitIds.length} units) → ${run.recommendedLabels?.find((r) => r.clusterId === c.id)?.labelId}`).join('\n')}

Confirmed labels for the focused units:
${confirmedHere.map((c) => `- ${c.unitId}: ${c.labelId} (${c.source})`).join('\n') || '(none yet)'}

Label ids you may propose: ${nodes.filter((n) => n.id !== 'root').map((n) => `${n.id} (${n.label})`).join(', ')}

Recent interaction log:
${recentLogs || '(empty)'}

Curator's question: ${question}`,
  });
  const unitIds = (out.unitIds || []).filter((id) => focusUnits.includes(id));
  return {
    answer: out.answer,
    suggestedLabelId: out.suggestedLabelId && allowed.has(out.suggestedLabelId) ? out.suggestedLabelId : null,
    unitIds: unitIds.length ? unitIds : focusUnits,
  };
}

export async function ask({ runId, focus, question }) {
  const s = load();
  const run = getRun(runId, s);
  if (!run?.clusters) throw new Error('No clustered run to chat about.');
  if (!question?.trim()) throw new Error('Question is empty.');
  const res = await model5Answer({ focus, question, run, s });
  const chat = { id: newId('chat'), runId, focus, question, ...res, decision: null, ts: new Date().toISOString() };
  s.chat.push(chat);
  save();
  return chat;
}

/** human evaluate + human assign + tool_4 expand */
export function decide({ chatId, accepted, labelId, unitIds, note }) {
  const s = load();
  const chat = s.chat.find((c) => c.id === chatId);
  if (!chat) throw new Error('unknown chat');
  const allowed = new Set(s.labelTaxonomy.nodes.map((n) => n.id));
  const apply = accepted && labelId && allowed.has(labelId);
  chat.decision = { accepted: !!accepted, labelId: apply ? labelId : null, unitIds: apply ? unitIds : [], note: note || '' };
  if (apply) {
    const now = new Date().toISOString();
    const set = new Set(unitIds);
    s.confirmedLabels = s.confirmedLabels.filter((c) => !set.has(c.unitId))
      .concat(unitIds.map((unitId) => ({ unitId, labelId, source: 'chat', runId: chat.runId, ts: now })));
    s.confirmedLabelsVersion += 1;
  }
  const before = s.interactionLogs.length;
  s.interactionLogs = tool4ExpandLogs(s.interactionLogs, { chat }).map((l, i) => (i >= before ? { id: newId('log'), ...l } : l));
  s.interactionLogsVersion += 1;
  save();
  return chat;
}
