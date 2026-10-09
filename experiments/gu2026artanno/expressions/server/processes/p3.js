// Process 3: [human select] focused cluster -> [human evaluate] annotation_feedback
//            -> [human assign] confirmed_labels_1 -> [tool_4 extract] interaction_logs_1
// The two human steps happen in the UI; this module commits their results and runs tool_4.
import { load, save, getRun, newId } from '../store.js';
import { tool4ExtractLogs } from '../tools/logs.js';

/**
 * @param {{runId:string, clusterId:string, labelId:string,
 *          feedback:{unitId:string, verdict:'agree'|'disagree'|'unsure', comment?:string, labelId?:string}[]}} input
 */
export function commitReview({ runId, clusterId, labelId, feedback }) {
  const s = load();
  const run = getRun(runId, s);
  if (!run) throw new Error('unknown run');
  const cluster = run.clusters.find((c) => c.id === clusterId);
  if (!cluster) throw new Error('unknown cluster');
  const labelIds = new Set(s.labelTaxonomy.nodes.map((n) => n.id));
  if (!labelIds.has(labelId)) throw new Error(`label ${labelId} is not in the taxonomy`);
  const now = new Date().toISOString();

  // annotation_feedback_1
  const fb = cluster.unitIds.map((unitId) => {
    const f = feedback.find((x) => x.unitId === unitId) || { verdict: 'agree' };
    return { id: newId('fb'), runId, clusterId, unitId, verdict: f.verdict, comment: f.comment || '', overrideLabelId: f.labelId && labelIds.has(f.labelId) ? f.labelId : null, ts: now };
  });
  s.annotationFeedback = s.annotationFeedback.filter((x) => !(x.runId === runId && x.clusterId === clusterId)).concat(fb);

  // confirmed_labels_1: agreeing units get the cluster label; disagreeing units get their override, if any.
  const confirmed = fb.flatMap((f) => {
    if (f.verdict === 'disagree') return f.overrideLabelId ? [{ unitId: f.unitId, labelId: f.overrideLabelId }] : [];
    if (f.verdict === 'unsure') return [];
    return [{ unitId: f.unitId, labelId }];
  }).map((c) => ({ ...c, source: 'review', runId, clusterId, ts: now }));
  const touched = new Set(cluster.unitIds);
  s.confirmedLabels = s.confirmedLabels.filter((c) => !touched.has(c.unitId)).concat(confirmed);

  // tool_4 extract -> interaction_logs_1
  const recommendedLabelId = run.recommendedLabels?.find((r) => r.clusterId === clusterId)?.labelId;
  const logs = tool4ExtractLogs({ run, clusterId, feedback: fb, confirmed, recommendedLabelId, now })
    .map((l) => ({ id: newId('log'), ...l }));
  s.interactionLogs.push(...logs);
  run.reviewed = [...new Set([...(run.reviewed || []), clusterId])];
  save();
  return { confirmed, logs };
}
