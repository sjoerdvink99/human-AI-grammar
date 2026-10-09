/** `code`: HTML, CSS and JavaScript code (code_1, code_2, code_3, training_webpages_*). */
export interface WebCode {
  html: string;
  css: string;
  js: string;
}

export type FileKey = keyof WebCode;
export const FILE_KEYS: FileKey[] = ["html", "css", "js"];
export const FILE_NAMES: Record<FileKey, string> = {
  html: "index.html",
  css: "style.css",
  js: "script.js",
};

/** `model_choice`: the code-generation model the developer picks (model_1). */
export const MODEL_CHOICES = ["haiku", "sonnet", "opus"] as const;
export type ModelChoice = (typeof MODEL_CHOICES)[number];

/** `*_rendering(s)`: a page loaded in a browser (tool_1 execute). */
export interface Rendering {
  screenshot: string; // base64 PNG
  consoleErrors: string[];
  loadMs: number;
}

/** `energy_before`, `energy_after`, `baseline_energy`, `optimized_energy` (tool_2 evaluate). */
export interface EnergyEstimate {
  joules: number;
  cpuJoules: number;
  gpuJoules: number;
  networkJoules: number;
  rendererCpuSeconds: number;
  gpuCpuSeconds: number;
  transferBytes: number;
  windowMs: number;
  runs: number;
}

/** `savings`, `energy_savings` (tool_5 / tool_4 evaluate). */
export interface Savings {
  joules: number;
  percent: number;
}

/** One block of changed lines in `diff`. */
export interface DiffHunk {
  id: string;
  file: FileKey;
  /** 1-based line in the original file where the hunk starts */
  oldStart: number;
  removed: string[];
  added: string[];
  /** a few unchanged lines before the hunk for context */
  contextBefore: string[];
  contextAfter: string[];
}

/** `diff`: line-by-line differences between original and optimized code. */
export interface CodeDiff {
  hunks: DiffHunk[];
}

/** `candidate_training_pairs`, `training_pairs` */
export interface TrainingPair {
  pageId: string;
  patterns: string[];
  before: WebCode;
  /** tool_3 output that was measured (minified) */
  after: WebCode;
  /** same rules before minification, readable for exemplars */
  afterReadable: WebCode;
  rulesApplied: string[];
  baselineEnergy: EnergyEstimate;
  optimizedEnergy: EnergyEstimate;
  savings: Savings;
  visualMismatch: number; // fraction of differing pixels
  consoleErrors: string[];
}

/** `optimizer_weights`: the "fine-tuned" optimization model. */
export interface OptimizerWeights {
  version: number;
  trainedAt: string;
  pagesProfiled: number;
  pairsUsed: number;
  /** pattern id → mean measured share of energy saved when the pattern is removed (0..1) */
  patternWeights: Record<
    string,
    {
      /** mean extra baseline energy (J) on pages with the pattern vs without */
      costJoules: number;
      /** cost relative to mean page energy, used to rank patterns (0..1+) */
      weight: number;
      /** mean savings percent achieved by the rule toolchain on pages with the pattern */
      ruleSavingsPercent: number;
      count: number;
      description: string;
    }
  >;
  meanBaselineJoules: number;
  /** highest-saving validated pairs, used as few-shot examples for model_2 */
  exemplars: { patterns: string[]; savingsPercent: number; before: WebCode; after: WebCode }[];
}

export interface MeasureResult {
  rendering: Rendering;
  energy: EnergyEstimate;
}

/** Response of process 3 up to the human select step. */
export interface OptimizeResponse {
  code1: WebCode;
  code2: WebCode;
  energyBefore: EnergyEstimate;
  energyAfter: EnergyEstimate;
  baselineRendering: Rendering;
  optimizedRendering: Rendering;
  savings: Savings;
  diff: CodeDiff;
  explanation: string[];
}
