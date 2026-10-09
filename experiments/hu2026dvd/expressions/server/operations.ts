/** Model operations from the design. One prompt per operation, built only from the preceding state. */
import { randomUUID } from 'node:crypto';
import { callModel } from './model';
import { ClipOutputSchema, MaskOutputSchema, ScriptsOutputSchema, VISUAL_KINDS } from '../shared/schemas';
import type { ClipRequest, Guideline, Scene } from '../shared/types';

/* ---------------- Process 1: [model_1 generate]~ ----------------
 * (topic_1 + data_facts_1* + guidelines_1*) -> scripts_1*
 */
export async function generateScripts(input: {
  topic: string;
  dataFacts: string[];
  guidelines: Guideline[];
}): Promise<Scene[]> {
  const system = [
    'You are a data-video scriptwriter. You turn a topic and a list of data facts into a short,',
    'engaging data video made of scenes. Follow the storytelling guidelines you are given.',
    'Use only the numbers that appear in the data facts; never invent statistics.',
    `Each scene has a visual whose kind is one of: ${VISUAL_KINDS.join(', ')}.`,
    '- headline: label = big title text; value = "" ; items = []',
    '- big_number: value = the number to show (e.g. "73%"), label = what it measures',
    '- bar: items = 2-6 {label, value} data points from the facts, label = chart title',
    '- comparison: exactly 2 items to compare, label = what is compared',
    '- quote: label = a short memorable sentence',
    'background is a dark-ish hex colour, accent a contrasting bright hex colour; keep the palette consistent across scenes.',
    'durationSec between 4 and 10. narration is what a voice-over would say (1-3 sentences).',
    'onScreenText is a short caption (max ~12 words). factIndexes lists the 0-based indexes of facts the scene uses.',
  ].join('\n');

  const prompt = [
    `TOPIC:\n${input.topic}`,
    `\nDATA FACTS:\n${input.dataFacts.map((f, i) => `[${i}] ${f}`).join('\n') || '(none)'}`,
    `\nSTORYTELLING GUIDELINES:\n${input.guidelines.map((g) => `- ${g.title}: ${g.text}`).join('\n') || '(none)'}`,
    '\nWrite 4-7 scenes: an opening hook, scenes that develop the data facts, and a closing takeaway.',
  ].join('\n');

  const out = await callModel({ role: 'model_1', system, prompt, schema: ScriptsOutputSchema });
  const n = input.dataFacts.length;
  // Enforce representation constraints where scripts are produced.
  return out.scenes.map((s) => ({
    ...s,
    id: randomUUID().slice(0, 8),
    durationSec: Math.min(10, Math.max(3, Math.round(s.durationSec))),
    factIndexes: [...new Set(s.factIndexes)].filter((i) => i >= 0 && i < n),
    visual: {
      ...s.visual,
      items: s.visual.kind === 'comparison' ? s.visual.items.slice(0, 2) : s.visual.items,
    },
  }));
}

/* ---------------- Process 4: [model_2 generate]~ ----------------
 * clip_request_1 -> clip_1 (animated SVG)
 */
export async function generateClip(req: ClipRequest): Promise<{ svg: string; caption: string }> {
  const system = [
    'You are a motion designer who produces short animated clips as a single self-contained SVG.',
    'Use SMIL (<animate>, <animateTransform>) or an internal <style> with CSS @keyframes for motion.',
    'No <script>, no external images, fonts or links, no event-handler attributes.',
    'The animation should loop or hold its final frame and read clearly on its own.',
  ].join('\n');
  const prompt = [
    `Create an animated clip for this scene of a data video.`,
    `Canvas: viewBox="0 0 ${req.width} ${req.height}", duration about ${req.durationSec} seconds.`,
    `Palette: background ${req.palette.background}, accent ${req.palette.accent}.`,
    `Scene title: ${req.title}`,
    `Narration: ${req.narration}`,
    `On-screen text: ${req.onScreenText}`,
    `Visual: ${JSON.stringify(req.visual)}`,
    'Return the SVG markup in "svg" and a one-line description in "caption".',
  ].join('\n');
  const out = await callModel({ role: 'model_2', system, prompt, schema: ClipOutputSchema, timeoutMs: 400_000 });
  return { svg: sanitizeSvg(out.svg), caption: out.caption };
}

export function sanitizeSvg(svg: string): string {
  const start = svg.indexOf('<svg');
  const end = svg.lastIndexOf('</svg>');
  if (start < 0 || end < 0) throw new Error('model_2 did not return an <svg> element');
  let s = svg.slice(start, end + 6);
  s = s.replace(/<script[\s\S]*?<\/script>/gi, '');
  s = s.replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '');
  s = s.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, '');
  s = s.replace(/(href\s*=\s*)("|')(?!#)[^"']*\2/gi, '$1$2#$2');
  if (!/xmlns=/.test(s)) s = s.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  return s;
}

/* ---------------- Processes 6/7: [model_3 extract] ----------------
 * keyframe + object_point -> object_mask (polygon)
 */
export async function extractMask(input: {
  image: Buffer;
  width: number;
  height: number;
  point: { x: number; y: number };
}): Promise<{ polygon: [number, number][]; objectName: string }> {
  const px = Math.round(input.point.x * input.width);
  const py = Math.round(input.point.y * input.height);
  const system = [
    'You are an image segmentation model. Given an image and a point, you outline the single object',
    'that contains the point. Return a polygon (8-40 vertices, clockwise) tightly around the visible',
    'object in normalized coordinates (x and y between 0 and 1, origin top-left).',
    'If the point is on plain background, set found=false and return the region of uniform content around it.',
  ].join('\n');
  const prompt = [
    `The image is ${input.width}x${input.height} pixels.`,
    `The user clicked at pixel (${px}, ${py}), i.e. normalized (${input.point.x.toFixed(3)}, ${input.point.y.toFixed(3)}).`,
    'Outline the object under that point. Include text glyphs, bars or shapes that form one visual element.',
  ].join('\n');
  const out = await callModel({
    role: 'model_3',
    system,
    prompt,
    schema: MaskOutputSchema,
    images: [{ name: 'keyframe.png', data: input.image }],
  });
  const polygon = out.polygon
    .map(([x, y]) => [clamp01(x), clamp01(y)] as [number, number])
    .filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (polygon.length < 3) throw new Error('model_3 returned a degenerate mask; try clicking again');
  return { polygon, objectName: out.objectName };
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
