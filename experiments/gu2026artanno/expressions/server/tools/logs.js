// tool_4 extract / expand: turn human actions into structured interaction_logs records.

/**
 * tool_4 extract (process 3): from annotation_feedback_1 and confirmed_labels_1 of one review,
 * produce log records describing what the human did with the AI recommendation.
 */
export function tool4ExtractLogs({ run, clusterId, feedback, confirmed, recommendedLabelId, now = new Date().toISOString() }) {
  const cluster = (run.clusters || []).find((c) => c.id === clusterId);
  const agree = feedback.filter((f) => f.verdict === 'agree').length;
  const disagree = feedback.filter((f) => f.verdict === 'disagree');
  const labelsUsed = [...new Set(confirmed.map((c) => c.labelId))];
  const logs = [{
    type: 'cluster_review',
    ts: now,
    runId: run.id,
    task: run.task,
    process: run.process,
    chosenSkills: run.chosenSkills,
    clusterId,
    clusterName: cluster?.name,
    clusterSize: cluster?.unitIds.length ?? 0,
    recommendedLabelId,
    confirmedLabelIds: labelsUsed,
    acceptedRecommendation: labelsUsed.length === 1 && labelsUsed[0] === recommendedLabelId,
    unitsAgreed: agree,
    unitsDisagreed: disagree.length,
    comments: feedback.filter((f) => f.comment).map((f) => ({ unitId: f.unitId, verdict: f.verdict, comment: f.comment })),
  }];
  for (const f of disagree) {
    const c = confirmed.find((x) => x.unitId === f.unitId);
    logs.push({ type: 'unit_override', ts: now, runId: run.id, clusterId, unitId: f.unitId, recommendedLabelId, confirmedLabelId: c?.labelId ?? null, comment: f.comment || '' });
  }
  return logs;
}

/** tool_4 expand (process 4): append a chat exchange and its decision to the logs. */
export function tool4ExpandLogs(logs, { chat, now = new Date().toISOString() }) {
  return [...logs, {
    type: 'chat_decision',
    ts: now,
    focus: chat.focus,
    question: chat.question,
    answer: chat.answer,
    suggestedLabelId: chat.suggestedLabelId,
    accepted: chat.decision.accepted,
    appliedLabelId: chat.decision.labelId ?? null,
    unitsAffected: chat.decision.unitIds ?? [],
    note: chat.decision.note || '',
  }];
}
