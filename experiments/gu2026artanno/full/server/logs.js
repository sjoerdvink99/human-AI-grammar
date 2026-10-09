// tool_4 — deterministic interaction logging.
// extract (process 3): annotation_feedback + confirmed_labels → interaction_logs_1
// expand  (process 4): interaction_logs_1 + chat round + decision → interaction_logs_2
import { save } from './store.js';

/** tool_4 extract */
export function extract(task, { clusterId, feedback, labels, focusedAt }) {
  const rec = {
    t: new Date().toISOString(), kind: 'review', target: { type: 'cluster', id: clusterId },
    data: {
      clusterName: task.clusters.find((c) => c.id === clusterId)?.name,
      recommended: task.clusters.find((c) => c.id === clusterId)?.recommendedLabels || [],
      feedback, confirmed: labels, dwellMs: focusedAt ? Date.now() - focusedAt : null,
    },
  };
  task.logs.push(rec); save();
  return rec;
}

/** tool_4 expand */
export function expand(task, { focus, question, answer, decision, labelsBefore, labelsAfter }) {
  const rec = {
    t: new Date().toISOString(), kind: 'chat', target: focus,
    data: { question, answer: answer.answer, comparisons: answer.comparisons, decision, labelsBefore, labelsAfter },
  };
  task.logs.push(rec); save();
  return rec;
}

/** Render logs for a model's context. */
export function formatLogs(logs) {
  return logs.map((l, i) => {
    if (l.kind === 'review') {
      const fb = l.data.feedback.map((f) => `${f.label}: ${f.verdict}${f.comment ? ` ("${f.comment}")` : ''}`).join('; ');
      return `#${i + 1} REVIEW cluster ${l.target.id} "${l.data.clusterName}" — recommended [${l.data.recommended.join(', ')}]; feedback: ${fb || 'none'}; confirmed [${l.data.confirmed.join(', ')}]`;
    }
    return `#${i + 1} CHAT about ${l.target.type} ${l.target.id} — Q: "${l.data.question}" A: "${l.data.answer.slice(0, 400)}" decision: ${l.data.decision.verdict}${l.data.decision.note ? ` ("${l.data.decision.note}")` : ''}; labels [${(l.data.labelsBefore || []).join(', ')}] → [${(l.data.labelsAfter || []).join(', ')}]`;
  }).join('\n');
}
