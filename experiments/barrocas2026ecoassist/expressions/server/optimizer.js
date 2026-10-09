// Process 3 — model_2 modify~: code_1 + optimizer_weights_1 + energy_before_1 -> code_2
import { callModel, extractHtml } from './model.js';
import { STRATEGIES } from './strategies.js';

export const OPTIMIZER_MODEL = process.env.OPTIMIZER_MODEL || 'sonnet';

const SYSTEM = `You are an energy optimizer for web pages shown on OLED displays, where each pixel's power
grows with its brightness and blue sub-pixels cost the most. You rewrite HTML/CSS so the rendered page
uses less display energy while keeping its content, structure, layout and readability (text contrast
must stay at least WCAG AA). Follow the learned strategy weights you are given: apply the highest-weighted
strategies first and most strongly; skip strategies with weight ≤ 0.
Make each change in place on the existing CSS declarations, inline styles or SVG attributes
(e.g. change a background colour value) rather than appending one global override or a CSS filter,
so that each change is a separate, independently reviewable edit. Do not reformat or reorder untouched lines.
Reply with only the complete revised HTML document inside one \`\`\`html code block.`;

export function buildOptimizerPrompt({ code, weights, energyBefore }) {
  const byId = Object.fromEntries(STRATEGIES.map((s) => [s.id, s.description]));
  const table = weights.strategies
    .map((s) => `- ${s.id} (weight ${s.weight.toFixed(3)} ≈ ${(s.weight * 100).toFixed(1)}% savings): ${byId[s.id]}`)
    .join('\n');
  return `Learned strategy weights (expected fractional energy savings per strategy, from ${weights.nPairs} training pairs):
${table}

Current estimated display power of this page: ${energyBefore.mW} mW (${(energyBefore.relative * 100).toFixed(1)}% of an all-white screen).

HTML to optimize:
\`\`\`html
${code}
\`\`\``;
}

export async function optimizeCode({ code, weights, energyBefore }) {
  if (!weights) throw new Error('optimizer is not trained yet — run training first');
  if (!code?.trim()) throw new Error('code is empty');
  const prompt = buildOptimizerPrompt({ code, weights, energyBefore });
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { text } = await callModel({ system: SYSTEM, prompt, model: OPTIMIZER_MODEL });
      return extractHtml(text);
    } catch (e) {
      lastErr = e;
      if (/timed out/.test(e.message)) break; // retry only invalid outputs
    }
  }
  throw lastErr;
}
