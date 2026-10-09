// Process 2 — model_1 generate~: request_1 + model_choice_1 -> code_1
import { callModel, extractHtml, MODEL_CHOICES } from './model.js';

const SYSTEM = `You are a front-end developer. You write a single, complete, self-contained HTML document
(inline <style> and optional inline <script>, no build step) that implements the user's request.
Use realistic placeholder content, and keep the document compact (at most about 300 lines). Do not load external scripts or fonts. Images, if any, should be
inline SVG or CSS shapes so the page renders offline. Format the CSS with one declaration per line so
the source is easy to diff. Reply with only the HTML inside one \`\`\`html code block.`;

export async function generateCode({ request, model }) {
  if (typeof request !== 'string' || !request.trim()) throw new Error('request is empty');
  if (!MODEL_CHOICES.includes(model)) throw new Error(`model must be one of ${MODEL_CHOICES.join(', ')}`);
  const { text } = await callModel({ system: SYSTEM, prompt: `Request:\n${request.trim()}`, model });
  return extractHtml(text);
}
