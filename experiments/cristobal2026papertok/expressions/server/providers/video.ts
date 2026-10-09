import { callLLM } from "./llm.ts";
import { renderSvg, sanitizeSvg, escapeXml, wrap } from "../tools/svg.ts";
import { stillToVideo, WIDTH, HEIGHT } from "../tools/media.ts";

export interface VideoRequest {
  /** one item of (visual_prompts_1: instruction language)* */
  visualPrompt: string;
  /** one item of (scene_durations_1: artifact numeric)* — the video must last this long */
  seconds: number;
  outStill: string;
  outVideo: string;
}

const MODEL_2_SYSTEM = `You are model_2, a visual generator for vertical short-form science videos.
Given a visual prompt, you draw ONE keyframe as a standalone SVG illustration.
Rules:
- Output only the SVG markup, starting with <svg and ending with </svg>. No prose, no code fences.
- Use viewBox="0 0 720 1280" with xmlns="http://www.w3.org/2000/svg".
- Fill the whole canvas with a background (gradient or solid). Flat, bold, modern editorial illustration style.
- Use only basic shapes, paths, gradients and at most 6 words of large text (font-family sans-serif, font-size >= 44).
- Keep the lower 20% of the canvas visually quiet (captions may sit there).
- No <script>, no <foreignObject>, no external images or fonts. Keep it under 9000 characters.`;

/** Placeholder frame used only if the generator fails twice. */
function fallbackSvg(prompt: string) {
  const lines = wrap(prompt, 26).slice(0, 8);
  const text = lines
    .map((l, i) => `<text x="360" y="${420 + i * 60}" font-family="sans-serif" font-size="40" fill="#fff" text-anchor="middle">${escapeXml(l)}</text>`)
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 1280"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1e3a8a"/><stop offset="1" stop-color="#7c3aed"/></linearGradient></defs><rect width="720" height="1280" fill="url(#g)"/>${text}</svg>`;
}

/**
 * model_2 generate~ : a silent scene video for a visual prompt, lasting exactly `seconds`.
 * Current provider: Claude (model_2 configuration) draws an SVG keyframe, which is rendered and
 * animated with a slow zoom. Swap this body for a text-to-video API to get real footage.
 */
export async function generateVideo(req: VideoRequest): Promise<{ usedFallback: boolean }> {
  let svg = "";
  let usedFallback = false;
  for (let attempt = 0; attempt < 2 && !svg; attempt++) {
    try {
      const out = await callLLM({
        role: "model_2",
        system: MODEL_2_SYSTEM,
        prompt: `Visual prompt:\n${req.visualPrompt}\n\nThe shot is on screen for ${req.seconds.toFixed(1)} seconds.`,
      });
      svg = sanitizeSvg(out);
      await renderSvg(svg, req.outStill, WIDTH, HEIGHT);
    } catch (e) {
      console.warn("[model_2] attempt failed:", (e as Error).message);
      svg = "";
    }
  }
  if (!svg) {
    usedFallback = true;
    await renderSvg(fallbackSvg(req.visualPrompt), req.outStill, WIDTH, HEIGHT);
  }
  await stillToVideo(req.outStill, req.seconds, req.outVideo);
  return { usedFallback };
}
