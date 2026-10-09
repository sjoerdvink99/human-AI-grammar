// [tool_3 select] (scenes and affordances) and [tool_5 evaluate] / [tool_5 train].

export function makeRng(seedStr) {
  let h = 2166136261;
  for (const ch of String(seedStr)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** [tool_3 select] scored_scenes_1 + retrieval_policy_1 -> sampled_scenes_1* (softmax sampling w/o replacement). */
export function sampleScenes(scoredScenes, candidateScenes, policy, rng) {
  const pool = scoredScenes.map((row) => ({ row, scene: candidateScenes.find((s) => s.id === row.scene_id) })).filter((p) => p.scene);
  const out = [];
  const n = Math.min(policy.n_scenes, pool.length);
  while (out.length < n) {
    const max = Math.max(...pool.map((p) => p.row.total));
    const ws = pool.map((p) => Math.exp((p.row.total - max) / Math.max(0.01, policy.temperature)));
    const sum = ws.reduce((a, b) => a + b, 0);
    let r = rng() * sum, i = 0;
    for (; i < ws.length - 1; i++) { r -= ws[i]; if (r <= 0) break; }
    const [picked] = pool.splice(i, 1);
    out.push({ ...picked.scene, sample_probability: ws[i] / sum });
  }
  return out;
}

export const AFFORDANCE_THRESHOLD = 0.35;
export const MAX_AFFORDANCES = 10;

/** [tool_3 select] scored_affordances_1 -> sampled_affordances_1* (best per key, above threshold, top-N). */
export function selectAffordances(scoredAffordances) {
  const best = new Map();
  for (const r of scoredAffordances) {
    if (!best.has(r.key) || best.get(r.key).total < r.total) best.set(r.key, r);
  }
  return [...best.values()]
    .filter((r) => r.total >= AFFORDANCE_THRESHOLD)
    .sort((a, b) => b.total - a.total)
    .slice(0, MAX_AFFORDANCES);
}

export const SIGNAL_REWARD = { realized: 1, partial: 0.3, violated: -1, absent: -0.5 };

/** [tool_5 evaluate] realization_signals_1* + retrieval_trace_1 -> rewards_1* */
export function computeRewards(signals, trace) {
  const rewards = [];
  const byKey = new Map(signals.map((s) => [s.key, s]));
  for (const a of trace.sampled_affordances) {
    const s = byKey.get(a.key);
    const reward = s ? SIGNAL_REWARD[s.signal] ?? 0 : 0;
    rewards.push({ kind: 'affordance', target: a.key, source_scene: a.source_scene, reward });
  }
  for (const sc of trace.sampled_scenes) {
    const mine = rewards.filter((r) => r.kind === 'affordance' && r.source_scene === sc.id);
    const reward = mine.length ? mine.reduce((a, r) => a + r.reward, 0) / mine.length : 0;
    rewards.push({ kind: 'scene', target: sc.id, reward: Math.round(reward * 1000) / 1000 });
  }
  return rewards;
}

/** [tool_5 train] rewards_1* + retrieval_policy_1 -> retrieval_policy_2 (bandit-style value updates). */
export function trainPolicy(rewards, policy, trace) {
  const p = structuredClone(policy);
  p.version = (policy.version || 1) + 1;
  const lr = p.lr;
  for (const r of rewards) {
    const table = r.kind === 'scene' ? p.scene_values : p.affordance_values;
    const v = table[r.target] ?? 0;
    table[r.target] = round(v + lr * (r.reward - v));
  }
  // Credit assignment for the mixing weights: features of sampled scenes that earned reward get more weight.
  const sceneRewards = rewards.filter((r) => r.kind === 'scene');
  const rows = trace.scored_scenes || [];
  const mean = (f) => rows.reduce((a, r) => a + (r[f] ?? 0), 0) / Math.max(1, rows.length);
  for (const [w, f] of [['w_embed', 'sim'], ['w_llm', 'llm_score'], ['w_pref', 'pref']]) {
    const m = mean(f);
    let g = 0;
    for (const sr of sceneRewards) {
      const row = rows.find((r) => r.scene_id === sr.target);
      if (row) g += sr.reward * ((row[f] ?? 0) - m);
    }
    p[w] = round(Math.min(1, Math.max(0.05, p[w] + 0.2 * lr * g)));
  }
  p.temperature = round(Math.max(0.05, p.temperature * 0.95));
  p.episodes = (p.episodes || 0) + 1;
  return p;
}

const round = (x) => Math.round(x * 1000) / 1000;
