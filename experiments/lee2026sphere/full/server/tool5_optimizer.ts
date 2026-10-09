// tool_5: policy-gradient optimizer with LoRA. Converts realization signals into rewards (evaluate)
// and updates the LoRA matrices of both rerankers with REINFORCE (train).
import type { LoraReranker, RealizationSignal, RetrievalPolicy, RetrievalTrace } from '../shared/types';
import { plackettLuceGradient } from './rerankers';

export const SIGNAL_REWARD: Record<RealizationSignal, number> = { realized: 1, partial: 0.5, not_realized: 0 };

export interface Rewards {
  affordances: { id: string; reward: number }[];
  scenes: { id: string; reward: number | null }[];
  mean: number | null;
}

/** tool_5 evaluate: realization signals → numeric rewards per retrieved affordance and per retrieved scene. */
export function computeRewards(signals: { affordanceId: string; signal: RealizationSignal }[], trace: RetrievalTrace): Rewards {
  const affordances = signals.map((s) => ({ id: s.affordanceId, reward: SIGNAL_REWARD[s.signal] }));
  const sceneOf = new Map(trace.affordances.candidates.map((c) => [c.id, c.sceneId]));
  const scenes = trace.scenes.chosen.map((id) => {
    const rs = affordances.filter((a) => sceneOf.get(a.id) === id).map((a) => a.reward);
    return { id, reward: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null };
  });
  const mean = affordances.length ? affordances.reduce((s, a) => s + a.reward, 0) / affordances.length : null;
  return { affordances, scenes, mean };
}

function applyUpdate(r: LoraReranker, g: { gA: number[][]; gB: number[][] }, lr: number, maxNorm = 1): { r: LoraReranker; norm: number } {
  let sq = 0;
  for (const M of [g.gA, g.gB]) for (const row of M) for (const v of row) sq += v * v;
  const norm = Math.sqrt(sq);
  const scale = norm > maxNorm ? maxNorm / norm : 1;
  const upd = (M: number[][], G: number[][]) => M.map((row, i) => row.map((v, j) => v + lr * scale * G[i][j]));
  return { r: { ...r, A: upd(r.A, g.gA), B: upd(r.B, g.gB) }, norm };
}

export interface TrainReport { updated: boolean; sceneGradNorm: number; affordanceGradNorm: number; baselineBefore: number; baselineAfter: number; note: string }

/** tool_5 train: retrieval_policy_1 + rewards → retrieval_policy_2. */
export function trainPolicy(policy: RetrievalPolicy, trace: RetrievalTrace, rewards: Rewards): { policy: RetrievalPolicy; report: TrainReport } {
  if (rewards.mean === null) {
    return { policy, report: { updated: false, sceneGradNorm: 0, affordanceGradNorm: 0, baselineBefore: policy.baseline, baselineAfter: policy.baseline, note: 'No preferences were retrieved in this session, so there is nothing to reinforce.' } };
  }
  const b = policy.baseline;

  // model_5: affordance reranker
  const aKeys = trace.affordances.candidates.map((c) => c.key);
  const aIdx = trace.affordances.chosen.map((id) => trace.affordances.candidates.findIndex((c) => c.id === id));
  const aAdv = trace.affordances.chosen.map((id) => (rewards.affordances.find((r) => r.id === id)?.reward ?? b) - b);
  const gAff = plackettLuceGradient(policy.affordanceReranker, trace.affordances.query, aKeys, aIdx, aAdv, policy.temperature);
  const aff = applyUpdate(policy.affordanceReranker, gAff, policy.learningRate);

  // model_4: scene reranker
  const sKeys = trace.scenes.candidates.map((c) => c.key);
  const sIdx = trace.scenes.chosen.map((id) => trace.scenes.candidates.findIndex((c) => c.id === id));
  const sAdv = trace.scenes.chosen.map((id) => { const r = rewards.scenes.find((s) => s.id === id)?.reward; return r === null || r === undefined ? 0 : r - b; });
  const gScene = plackettLuceGradient(policy.sceneReranker, trace.queryEmbedding, sKeys, sIdx, sAdv, policy.temperature);
  const scn = applyUpdate(policy.sceneReranker, gScene, policy.learningRate);

  const baselineAfter = 0.8 * b + 0.2 * rewards.mean;
  const next: RetrievalPolicy = {
    ...policy,
    version: policy.version + 1,
    baseline: Math.round(baselineAfter * 1000) / 1000,
    sceneReranker: scn.r,
    affordanceReranker: aff.r,
    history: [...policy.history, { version: policy.version + 1, at: new Date().toISOString(), meanReward: rewards.mean, sessionId: trace.sessionId }],
  };
  return {
    policy: next,
    report: { updated: true, sceneGradNorm: round(scn.norm), affordanceGradNorm: round(aff.norm), baselineBefore: b, baselineAfter: next.baseline, note: `REINFORCE step, advantage = reward − baseline ${b}` },
  };
}
const round = (v: number) => Math.round(v * 10000) / 10000;
