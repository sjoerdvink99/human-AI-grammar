import type { ModelChoice, OptimizerWeights, WebCode } from "../shared/types.ts";
import { MODEL_CHOICES } from "../shared/types.ts";
import { callModel, parseJsonReply } from "./llm.ts";

/** Validate a WebCode-shaped model output (code_1 / code_2). */
export function validateWebCode(x: unknown): WebCode {
  const o = x as Partial<WebCode> | null;
  if (!o || typeof o !== "object") throw new Error("model output is not an object");
  for (const k of ["html", "css", "js"] as const) {
    if (typeof o[k] !== "string") throw new Error(`model output is missing string field "${k}"`);
  }
  if (!/<html|<body|<div|<main|<!doctype/i.test(o.html!)) throw new Error("model output html does not look like an HTML document");
  return { html: o.html!, css: o.css!, js: o.js! };
}

async function withRetry<T>(fn: (attempt: number) => Promise<T>, attempts = 2): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn(i);
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

// ---------------------------------------------------------------------------
// model_1 generate~ : request_1 + model_choice_1 → code_1
// ---------------------------------------------------------------------------

const MODEL_1_SYSTEM = `You are a frontend code generator inside a web IDE.
Produce a complete, working single-page frontend as three files:
- index.html: a full HTML document that links <link rel="stylesheet" href="style.css"> in <head> and <script src="script.js"></script> at the end of <body>
- style.css
- script.js (plain browser JavaScript, no modules, no external dependencies or CDNs)
Write readable, formatted code (not minified).
Reply with ONLY a JSON object: {"html": "...", "css": "...", "js": "..."}`;

export async function generateCode(request: string, modelChoice: ModelChoice): Promise<WebCode> {
  if (!request.trim()) throw new Error("request is empty");
  if (!MODEL_CHOICES.includes(modelChoice)) throw new Error(`unknown model choice ${modelChoice}`);
  return withRetry(async (attempt) => {
    const text = await callModel({
      model: modelChoice,
      system: MODEL_1_SYSTEM,
      prompt: `Build this frontend application:\n\n${request}${attempt ? "\n\nYour previous reply was not valid JSON with html, css and js string fields. Reply with only the JSON object." : ""}`,
    });
    return validateWebCode(parseJsonReply(text));
  });
}

// ---------------------------------------------------------------------------
// model_2 modify~ : code_1 + optimizer_weights_1 (+ energy_before_1) → code_2
// ---------------------------------------------------------------------------

export const MODEL_2 = process.env.OPTIMIZER_MODEL || "sonnet";

function optimizerSystem(weights: OptimizerWeights | null): string {
  const ranked = weights
    ? Object.entries(weights.patternWeights)
        .sort((a, b) => b[1].weight - a[1].weight)
        .map(([id, w]) => `- ${id} (weight ${w.weight.toFixed(2)}, measured extra ≈ ${w.costJoules.toFixed(2)} J per page): ${w.description}`)
        .join("\n")
    : "(no trained weights available — rely on general knowledge)";
  const exemplars = (weights?.exemplars ?? [])
    .map(
      (e, i) =>
        `### Example ${i + 1} — patterns: ${e.patterns.join(", ")}; measured saving ${e.savingsPercent.toFixed(1)}%\nBEFORE:\n${JSON.stringify(e.before)}\nAFTER:\n${JSON.stringify(e.after)}`,
    )
    .join("\n\n");
  return `You are an energy-aware frontend optimizer. You rewrite HTML/CSS/JS so the page uses less CPU, GPU and network energy while looking and behaving the same for the user.

Energy-intensive patterns learned from profiling ${weights?.pagesProfiled ?? 0} webpages, ranked by measured energy cost (higher weight = fix first):
${ranked}

Typical fixes: clamp timers to ≥16 ms or use requestAnimationFrame only while something changes; animate transform/opacity instead of layout or paint-heavy properties; stop infinite animations when off-screen or limit them; batch DOM reads before writes; use passive listeners and throttle scroll handlers; lazy-load below-the-fold images; remove blanket will-change; virtualize or paginate very large DOMs; remove dead code.

Rules:
- Keep the same visible content, layout and functionality.
- Keep the code formatted and readable (do NOT minify) and keep unchanged lines byte-identical, so a line diff stays small and reviewable.
- Keep the three-file structure (index.html links style.css and script.js).
- Reply with ONLY a JSON object: {"html": "...", "css": "...", "js": "...", "changes": ["short description of each optimization"]}

${exemplars ? `Validated training pairs (before → after) from the profiling pipeline:\n\n${exemplars}` : ""}`;
}

export async function optimizeCode(
  code1: WebCode,
  weights: OptimizerWeights | null,
  energyBeforeJoules: number,
): Promise<{ code: WebCode; changes: string[] }> {
  return withRetry(async (attempt) => {
    const text = await callModel({
      model: MODEL_2,
      system: optimizerSystem(weights),
      prompt: `Measured energy of this page: ${energyBeforeJoules.toFixed(3)} J (load + 2 s idle).\nOptimize it.\n\n${JSON.stringify(code1)}${attempt ? "\n\nReply with only the JSON object." : ""}`,
      timeoutMs: 360_000,
    });
    const parsed = parseJsonReply<WebCode & { changes?: unknown }>(text);
    const code = validateWebCode(parsed);
    const changes = Array.isArray(parsed.changes) ? parsed.changes.map(String) : [];
    return { code, changes };
  });
}
