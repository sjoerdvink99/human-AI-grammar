// Process 1: build training pairs from a page corpus and train optimizer_weights (model_2).
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderHtml } from './render.js';
import { estimateEnergy, computeSavings } from './energy.js';
import { applyStrategies, variantPlans, STRATEGY_IDS } from './strategies.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const TRAINING_DIR = path.join(ROOT, 'data', 'training');
export const WEIGHTS_FILE = path.join(ROOT, 'data', 'optimizer_weights.json');
export const MIN_SAVINGS = 0.02; // tool_4 select: keep pairs saving at least 2 %
const RIDGE_LAMBDA = 0.05;

/** training_webpages_1 */
export async function loadTrainingWebpages() {
  const files = (await fs.readdir(TRAINING_DIR)).filter((f) => f.endsWith('.html')).sort();
  return Promise.all(
    files.map(async (f) => ({ id: f.replace(/\.html$/, ''), html: await fs.readFile(path.join(TRAINING_DIR, f), 'utf8') })),
  );
}

/** tool_4 compose: one record per (original page, modified variant). */
export function composePairs(variants, baselineEnergy, optimizedEnergy, energySavings) {
  return variants.map((v, i) => ({
    pageId: v.pageId,
    strategies: v.strategies,
    x: STRATEGY_IDS.map((id) => (v.strategies.includes(id) ? 1 : 0)),
    before: baselineEnergy[v.pageIndex],
    after: optimizedEnergy[i],
    savings: energySavings[i].relative,
  }));
}

/** tool_4 select */
export function selectPairs(candidates, minSavings = MIN_SAVINGS) {
  return candidates.filter((p) => p.savings >= minSavings);
}

/** model_2 train: ridge least squares, savings ≈ Σ w_s · x_s (no intercept: no edits, no savings). */
export function trainOptimizer(pairs, lambda = RIDGE_LAMBDA) {
  const k = STRATEGY_IDS.length;
  const A = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => (i === j ? lambda : 0)));
  const b = new Array(k).fill(0);
  for (const p of pairs) {
    for (let i = 0; i < k; i++) {
      b[i] += p.x[i] * p.savings;
      for (let j = 0; j < k; j++) A[i][j] += p.x[i] * p.x[j];
    }
  }
  const w = solve(A, b);
  const support = STRATEGY_IDS.map((_, i) => pairs.filter((p) => p.x[i]).length);
  return {
    strategies: STRATEGY_IDS.map((id, i) => ({ id, weight: round(w[i]), support: support[i] })).sort(
      (a, b2) => b2.weight - a.weight,
    ),
    nPairs: pairs.length,
    lambda,
    trainedAt: new Date().toISOString(),
  };
}

/** Run the whole of process 1. `onProgress(message)` receives step updates. */
export async function runTraining({ onProgress = () => {}, seed = 1 } = {}) {
  const rand = mulberry32(seed);
  const training_webpages_1 = await loadTrainingWebpages();
  onProgress({ step: 'load', message: `Loaded ${training_webpages_1.length} training pages` });

  // tool_1 execute + tool_2 evaluate on originals
  const baseline_energy_1 = [];
  for (const [i, p] of training_webpages_1.entries()) {
    baseline_energy_1.push(estimateEnergy(await renderHtml(p.html)));
    onProgress({ step: 'baseline', message: `Baseline ${i + 1}/${training_webpages_1.length}: ${p.id} ${baseline_energy_1[i].mW} mW` });
  }

  // tool_3 modify
  const training_webpages_2 = training_webpages_1.flatMap((p, pageIndex) =>
    variantPlans(rand).map((strategies) => ({ pageId: p.id, pageIndex, strategies, html: applyStrategies(p.html, strategies) })),
  );
  onProgress({ step: 'modify', message: `Created ${training_webpages_2.length} modified variants` });

  // tool_1 execute + tool_2 evaluate on variants
  const optimized_energy_1 = [];
  for (const [i, v] of training_webpages_2.entries()) {
    optimized_energy_1.push(estimateEnergy(await renderHtml(v.html)));
    if (i % 5 === 4 || i === training_webpages_2.length - 1)
      onProgress({ step: 'optimized', message: `Rendered variants ${i + 1}/${training_webpages_2.length}` });
  }

  // tool_4 evaluate / compose / select
  const energy_savings_1 = training_webpages_2.map((v, i) => computeSavings(baseline_energy_1[v.pageIndex], optimized_energy_1[i]));
  const candidate_training_pairs_1 = composePairs(training_webpages_2, baseline_energy_1, optimized_energy_1, energy_savings_1);
  const training_pairs_1 = selectPairs(candidate_training_pairs_1);
  onProgress({ step: 'select', message: `Selected ${training_pairs_1.length}/${candidate_training_pairs_1.length} pairs with ≥${MIN_SAVINGS * 100}% savings` });

  // model_2 train
  const optimizer_weights_1 = trainOptimizer(training_pairs_1);
  await fs.writeFile(WEIGHTS_FILE, JSON.stringify(optimizer_weights_1, null, 2));
  onProgress({ step: 'train', message: 'Trained optimizer weights' });
  return { optimizer_weights_1, candidate_training_pairs_1, training_pairs_1 };
}

export async function loadOptimizerWeights() {
  try {
    return JSON.parse(await fs.readFile(WEIGHTS_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c || !M[c][c]) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => (row[i] ? row[n] / row[i] : 0));
}

function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const round = (x) => Math.round(x * 10000) / 10000;
