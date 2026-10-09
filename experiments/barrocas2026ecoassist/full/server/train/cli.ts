import { runPipeline } from "./pipeline.ts";
import { closeBrowser } from "../tools/browser.ts";

// Usage: npm run train -- --pages 500 [--window 1000] [--runs 1] [--seed 42]
const args = process.argv.slice(2);
const opt = (name: string, def: number) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : def;
};

const started = Date.now();
const result = await runPipeline({
  pages: opt("pages", 500),
  windowMs: opt("window", 1000),
  runs: opt("runs", 1),
  seed: opt("seed", 42),
  onProgress: (msg, done, total) => process.stdout.write(`[${done}/${total}] ${msg}\n`),
});
await closeBrowser();
console.log(
  `\nProfiled ${result.weights.pagesProfiled} pages → ${result.candidates} candidate pairs → ${result.selected} training pairs in ${Math.round((Date.now() - started) / 1000)} s`,
);
console.table(
  Object.fromEntries(
    Object.entries(result.weights.patternWeights).map(([k, v]) => [k, { weight: v.weight, costJ: v.costJoules, ruleSave: v.ruleSavingsPercent, n: v.count }]),
  ),
);
