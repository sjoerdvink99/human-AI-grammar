// Process 4 — Ask the chatbot and refine a decision. model_5 generate~ (Chatbot Agent).
import { z } from 'zod';
import { callModelJson } from './llm.js';
import { findArtwork, imagePath, taxonomyLeaves, allUnits } from './store.js';
import { formatLogs } from './logs.js';

const AnswerSchema = z.object({
  answer: z.string().min(1),
  comparisons: z.array(z.object({ item: z.string(), contrast: z.string() })).default([]),
  suggested_labels: z.array(z.string()).default([]),
});

export const focusKey = (f) => `${f.type}:${f.id}`;

/** Artwork ids referenced by a chat focus (an artwork, or the artworks behind a cluster's regions). */
export function focusArtworkIds(task, focus) {
  if (focus.type === 'artwork') return [focus.id];
  const c = task.clusters.find((k) => k.id === focus.id);
  return [...new Set((c?.unitIds || []).map((u) => u.split('.')[0]))];
}

/** model_5 generate~ */
export async function chatAnswer(task, focus, question) {
  const leaves = taxonomyLeaves();
  const units = allUnits();
  const artIds = focusArtworkIds(task, focus);
  const cluster = focus.type === 'cluster' ? task.clusters.find((c) => c.id === focus.id) : null;
  const clustersTouching = task.clusters.filter((c) => c.unitIds.some((u) => artIds.includes(u.split('.')[0])));
  const confirmed = Object.entries(task.confirmed).map(([k, v]) => `${k}: [${v.labels.join(', ')}]`).join('\n') || '(none yet)';
  const out = await callModelJson({
    system: 'You are the Chatbot Agent of an artwork annotation system. You help an annotator decide on implicit cultural meanings. Answer the question about the selected image or cluster with concrete visual evidence and cultural conventions; when it helps, compare with other artworks or clusters in the collection. Be honest about uncertainty. Keep answers under 200 words.',
    prompt: `Selected ${focus.type}: ${focus.id}${cluster ? ` "${cluster.name}" — ${cluster.pattern || ''}` : ''}
Artworks in focus:
${artIds.map((id) => { const a = findArtwork(id); return `${id} "${a.metadata.title}" (${a.metadata.period}, ${a.metadata.origin}; ${a.metadata.notes || ''})\n  regions: ${units.filter((u) => u.artworkId === id).map((u) => `${u.id}[${u.basicLabel}]`).join(', ')}`; }).join('\n')}

All clusters and their recommended labels:
${task.clusters.map((c) => `${c.id} "${c.name}": ${c.unitIds.join(', ')} → recommended [${(c.recommendedLabels || []).join(', ')}]`).join('\n')}
Clusters touching the focus: ${clustersTouching.map((c) => c.id).join(', ') || 'none'}

Confirmed labels so far:
${confirmed}

Interaction log:
${formatLogs(task.logs) || '(empty)'}

Allowed labels: ${leaves.join(' | ')}

Annotator question: ${question}

Answer the question. If a comparison with other items clarifies it, list them. If the answer implies which labels fit the selected ${focus.type}, list them in suggested_labels (allowed labels only).
JSON: {"answer":"...","comparisons":[{"item":"art-3 or c2","contrast":"..."}],"suggested_labels":["..."]}`,
    images: artIds.slice(0, 4).map((id) => imagePath(findArtwork(id))),
    schema: AnswerSchema,
  });
  out.suggested_labels = out.suggested_labels.filter((l) => leaves.includes(l)); // enforce taxonomy
  return out;
}
