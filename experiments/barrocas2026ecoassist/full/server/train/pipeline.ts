import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import type { EnergyEstimate, OptimizerWeights, Rendering, Savings, TrainingPair, WebCode } from "../../shared/types.ts";
import { measure } from "../tools/energy.ts";
import { ruleOptimize } from "../tools/ruleOptimizer.ts";
import { generateCorpus, type CorpusPage } from "./corpus.ts";
import { trainOptimizer } from "./train.ts";

/**
 * Process 1 — Train energy-aware optimizer (offline).
 * Each step is a named function so it can be traced to the design.
 */

export const DATA_DIR = path.resolve(process.cwd(), "data");
export const WEIGHTS_FILE = path.join(DATA_DIR, "optimizer_weights.json");
const TRAIN_DIR = path.join(DATA_DIR, "training");

export interface PipelineOptions {
  pages: number;
  seed?: number;
  windowMs?: number;
  runs?: number;
  /** minimum saving (percent) for a pair to count as "saved energy" */
  minSavingsPercent?: number;
  /** maximum fraction of differing pixels for a pair to count as "still works" */
  maxVisualMismatch?: number;
  onProgress?: (msg: string, done: number, total: number) => void;
}

interface Measured {
  page: CorpusPage;
  baselineRendering: Rendering;
  baselineEnergy: EnergyEstimate;
  optimized?: { code: WebCode; readable: WebCode; applied: string[] };
  optimizedRendering?: Rendering;
  optimizedEnergy?: EnergyEstimate;
  savings?: Savings;
}

/** tool_4 evaluate: energy_savings_1 from baseline_energy_1 and optimized_energy_1 */
export function computeSavings(before: EnergyEstimate, after: EnergyEstimate): Savings {
  const joules = before.joules - after.joules;
  return { joules, percent: before.joules > 0 ? (100 * joules) / before.joules : 0 };
}

/** Fraction of pixels that differ between two renderings ("still works" check). */
export function visualMismatch(a: Rendering, b: Rendering): number {
  try {
    const pa = PNG.sync.read(Buffer.from(a.screenshot, "base64"));
    const pb = PNG.sync.read(Buffer.from(b.screenshot, "base64"));
    if (pa.width !== pb.width || pa.height !== pb.height) return 1;
    const diff = pixelmatch(pa.data, pb.data, undefined, pa.width, pa.height, { threshold: 0.2 });
    return diff / (pa.width * pa.height);
  } catch {
    return 1;
  }
}

/** tool_4 compose: candidate_training_pairs_1 */
export function composePairs(items: Measured[]): TrainingPair[] {
  return items
    .filter((m) => m.optimized && m.optimizedEnergy && m.savings && m.optimizedRendering)
    .map((m) => ({
      pageId: m.page.id,
      patterns: m.page.patterns,
      before: m.page.code,
      after: m.optimized!.code,
      afterReadable: m.optimized!.readable,
      rulesApplied: m.optimized!.applied,
      baselineEnergy: m.baselineEnergy,
      optimizedEnergy: m.optimizedEnergy!,
      savings: m.savings!,
      visualMismatch: visualMismatch(m.baselineRendering, m.optimizedRendering!),
      consoleErrors: m.optimizedRendering!.consoleErrors.filter((e) => !m.baselineRendering.consoleErrors.includes(e)),
    }));
}

/** tool_4 select: training_pairs_1 = pairs that saved energy and still work */
export function selectPairs(candidates: TrainingPair[], minSavingsPercent = 1, maxVisualMismatch = 0.05): TrainingPair[] {
  return candidates.filter(
    (p) => p.savings.percent >= minSavingsPercent && p.visualMismatch <= maxVisualMismatch && p.consoleErrors.length === 0,
  );
}

export async function runPipeline(opts: PipelineOptions): Promise<{ weights: OptimizerWeights; candidates: number; selected: number }> {
  const { pages, seed = 42, windowMs = 1000, runs = 1, onProgress = () => {} } = opts;
  fs.mkdirSync(TRAIN_DIR, { recursive: true });

  // (training_webpages_1)*
  const corpus = generateCorpus(pages, seed);
  const measured: Measured[] = [];

  for (let i = 0; i < corpus.length; i++) {
    const page = corpus[i];
    onProgress(`profiling ${page.id} [${page.patterns.join(", ")}]`, i, corpus.length);
    // tool_1 execute + tool_2 evaluate → baseline_renderings_1, baseline_energy_1
    const base = await measure(page.code, { windowMs, runs });
    const m: Measured = { page, baselineRendering: base.rendering, baselineEnergy: base.energy };
    // tool_3 modify → training_webpages_2
    const opt = await ruleOptimize(page.code);
    m.optimized = opt;
    // tool_1 execute + tool_2 evaluate → optimized_renderings_1, optimized_energy_1
    const after = await measure(opt.code, { windowMs, runs });
    m.optimizedRendering = after.rendering;
    m.optimizedEnergy = after.energy;
    // tool_4 evaluate → energy_savings_1
    m.savings = computeSavings(m.baselineEnergy, m.optimizedEnergy);
    measured.push(m);
  }

  const candidates = composePairs(measured);
  const selected = selectPairs(candidates, opts.minSavingsPercent, opts.maxVisualMismatch);
  const strip = (p: TrainingPair) => ({ ...p, before: undefined, after: undefined, afterReadable: undefined });
  fs.writeFileSync(path.join(TRAIN_DIR, "candidates.json"), JSON.stringify(candidates.map(strip), null, 1));
  fs.writeFileSync(path.join(TRAIN_DIR, "pairs.json"), JSON.stringify(selected.map(strip), null, 1));

  // model_2 train → optimizer_weights_1
  onProgress("training optimizer", corpus.length, corpus.length);
  const weights = trainOptimizer(candidates, selected, corpus.length);
  fs.writeFileSync(WEIGHTS_FILE, JSON.stringify(weights, null, 1));
  return { weights, candidates: candidates.length, selected: selected.length };
}

export function loadWeights(): OptimizerWeights | null {
  try {
    return JSON.parse(fs.readFileSync(WEIGHTS_FILE, "utf8"));
  } catch {
    return null;
  }
}
