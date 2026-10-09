import type { OptimizerWeights, TrainingPair, WebCode } from "../../shared/types.ts";
import { PATTERNS } from "./corpus.ts";

/**
 * model_2 train → optimizer_weights_1.
 *
 * No fine-tuning API is available in this environment (the provider is the Claude Code CLI),
 * so "training" fits the parameters that condition model_2 instead of network weights:
 *   - numeric per-pattern weights estimated from the measured energy of every profiled page
 *     (mean baseline energy with the pattern minus without, normalised by mean page energy),
 *   - the toolchain's measured savings on pages with each pattern,
 *   - a small set of validated before/after exemplars (training_pairs_1) for few-shot prompting.
 */
export function trainOptimizer(candidates: TrainingPair[], selected: TrainingPair[], pagesProfiled: number): OptimizerWeights {
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const meanBaselineJoules = mean(candidates.map((c) => c.baselineEnergy.joules));

  const patternWeights: OptimizerWeights["patternWeights"] = {};
  for (const [id, description] of Object.entries(PATTERNS)) {
    const withP = candidates.filter((c) => c.patterns.includes(id));
    const withoutP = candidates.filter((c) => !c.patterns.includes(id));
    const costJoules = mean(withP.map((c) => c.baselineEnergy.joules)) - mean(withoutP.map((c) => c.baselineEnergy.joules));
    patternWeights[id] = {
      costJoules: round(costJoules),
      weight: round(meanBaselineJoules > 0 ? Math.max(0, costJoules) / meanBaselineJoules : 0),
      ruleSavingsPercent: round(mean(withP.map((c) => c.savings.percent))),
      count: withP.length,
      description,
    };
  }

  const size = (c: WebCode) => c.html.length + c.css.length + c.js.length;
  const exemplars: OptimizerWeights["exemplars"] = [];
  const covered = new Set<string>();
  for (const p of [...selected].sort((a, b) => b.savings.percent - a.savings.percent)) {
    if (exemplars.length >= 3) break;
    if (size(p.before) > 6000) continue;
    if (p.patterns.every((x) => covered.has(x))) continue;
    p.patterns.forEach((x) => covered.add(x));
    exemplars.push({ patterns: p.patterns, savingsPercent: round(p.savings.percent), before: p.before, after: p.afterReadable });
  }

  return {
    version: 1,
    trainedAt: new Date().toISOString(),
    pagesProfiled,
    pairsUsed: selected.length,
    patternWeights,
    meanBaselineJoules: round(meanBaselineJoules),
    exemplars,
  };
}

function round(x: number) {
  return Math.round(x * 1000) / 1000;
}
