/**
 * Model roles of the design. Each role has its own system prompt and output
 * schema; each operation has exactly one prompt, built only from the
 * representations of the state that precedes it.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { callModel } from './llm.ts';

// ---------------------------------------------------------------- model_1
const MODEL_1_SYSTEM =
  'You are model_1, a language model helping a visualization designer find figurative concepts ' +
  '(concrete, drawable objects or creatures) that relate semantically to a dataset, so that each data row ' +
  'can be drawn as a pictorial glyph. Respond only with the requested JSON.';

/** [model_1 generate]~ : dataset_description_1 -> keyword_response_1 */
export async function generateKeywords(datasetDescription: string): Promise<string> {
  const prompt =
    `Dataset description:\n${datasetDescription}\n\n` +
    'Suggest 8 short keywords (1–3 words each) naming concrete, easily drawable objects that are semantically ' +
    'related to this dataset and that have several distinct visual parts which could encode the attributes ' +
    '(e.g. a flower with petals, stem and leaves). Give each a relevance weight from 1 (loose) to 10 (strong) and a one-line reason.';
  const schema = {
    type: 'object',
    properties: {
      keywords: {
        type: 'array',
        items: {
          type: 'object',
          properties: { word: { type: 'string' }, weight: { type: 'number' }, reason: { type: 'string' } },
          required: ['word', 'weight'],
        },
      },
    },
    required: ['keywords'],
  };
  const r = await callModel('model_1', { system: MODEL_1_SYSTEM, prompt, schema });
  // keyword_response_1 is the raw reply; tool_1 extract parses it on the client
  return r.data ? JSON.stringify(r.data) : r.text;
}

// ---------------------------------------------------------------- model_2
const MODEL_2_SYSTEM =
  'You are model_2, an image generation model that draws flat, figurative vector illustrations as SVG. ' +
  'Rules for every image: root <svg> with viewBox="0 0 256 256" and xmlns="http://www.w3.org/2000/svg"; ' +
  'between 6 and 40 primitive shapes (path, rect, circle, ellipse, polygon, polyline, line); ' +
  'each visually distinct part of the object (e.g. petals, stem, leaf, eyes) drawn as its own shape(s); ' +
  'solid fills with clear outlines; no text, no <image>, no <script>, no filters, no external references; ' +
  'transparent background (no full-canvas background rectangle); object centred and filling most of the canvas. ' +
  'Respond only with the requested JSON.';

const SVG_SHAPES = /<(path|rect|circle|ellipse|polygon|polyline|line)\b/gi;

/** Validate and sanitise model SVG output. Returns null when unusable. */
export function sanitizeSvg(raw: string): string | null {
  const m = raw.match(/<svg[\s\S]*?<\/svg>/i);
  if (!m) return null;
  let svg = m[0];
  svg = svg
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '')
    .replace(/<image\b[^>]*>/gi, '')
    .replace(/<text[\s\S]*?<\/text>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, '')
    .replace(/(xlink:)?href\s*=\s*("https?:[^"]*"|'https?:[^']*')/gi, '');
  const shapes = svg.match(SVG_SHAPES)?.length ?? 0;
  if (shapes < 2) return null;
  if (!/viewBox/i.test(svg)) svg = svg.replace(/<svg\b/i, '<svg viewBox="0 0 256 256"');
  if (!/xmlns=/i.test(svg)) svg = svg.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  return svg;
}

/** [model_2 generate]~ : image prompt -> three candidate images */
export async function generateImages(imagePrompt: string, count = 3): Promise<{ svg: string; title: string }[]> {
  const prompt =
    `${imagePrompt}\n\nDraw ${count} clearly different candidate designs of this concept ` +
    '(vary pose, style or composition). Return each as a complete SVG string with a short title.';
  const schema = {
    type: 'object',
    properties: {
      images: {
        type: 'array',
        items: {
          type: 'object',
          properties: { title: { type: 'string' }, svg: { type: 'string' } },
          required: ['title', 'svg'],
        },
      },
    },
    required: ['images'],
  };
  const r = await callModel<{ images: { title: string; svg: string }[] }>('model_2', {
    system: MODEL_2_SYSTEM,
    prompt,
    schema,
    timeoutMs: 300_000,
  });
  const images = (r.data?.images ?? [])
    .map((im) => ({ title: String(im.title ?? ''), svg: sanitizeSvg(String(im.svg ?? '')) }))
    .filter((im): im is { title: string; svg: string } => im.svg !== null)
    .slice(0, count);
  if (images.length === 0) throw new Error('model_2 returned no valid SVG images');
  return images;
}

// ---------------------------------------------------------------- model_3
const MODEL_3_SYSTEM =
  'You are model_3, an image segmentation model working on vector images. Given an SVG image, the list of ' +
  'its shapes with bounding boxes, and a box prompt drawn by the user, you return the mask: the ids of the ' +
  'shapes that together form the single coherent object part the box was drawn around. Respond only with JSON.';

export interface ShapeInfo {
  gid: string;
  tag: string;
  bbox: [number, number, number, number];
  fill?: string;
}

/** [model_3 extract] : glyph_image_1 + region -> mask (shape ids) */
export async function segmentRegion(
  svg: string,
  shapes: ShapeInfo[],
  box: [number, number, number, number],
): Promise<{ gids: string[]; name: string }> {
  const prompt =
    `SVG image:\n${svg}\n\nShapes (gid, tag, bbox [x, y, width, height], fill):\n` +
    shapes.map((s) => `${s.gid}\t${s.tag}\t[${s.bbox.map((v) => Math.round(v)).join(', ')}]\t${s.fill ?? ''}`).join('\n') +
    `\n\nBox prompt [x, y, width, height]: [${box.map((v) => Math.round(v)).join(', ')}]\n\n` +
    'Return the gids of the shapes forming the part inside the box (include small details belonging to the part, ' +
    'exclude shapes that mainly belong to other parts or that only touch the box edge), and a short name for the part.';
  const schema = {
    type: 'object',
    properties: { gids: { type: 'array', items: { type: 'string' } }, name: { type: 'string' } },
    required: ['gids', 'name'],
  };
  const r = await callModel<{ gids: string[]; name: string }>('model_3', { system: MODEL_3_SYSTEM, prompt, schema });
  return { gids: (r.data?.gids ?? []).map(String), name: String(r.data?.name ?? 'part') };
}

// ---------------------------------------------------------------- model_4
const MODEL_4_SYSTEM =
  'You are model_4, a vision-language model. You look at an image of one cut-out part of an illustration ' +
  'and describe the visual object it shows. Respond only with JSON.';

/** [model_4 generate]~ : fragment image -> fragment description */
export async function describeFragment(pngBase64: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fgv-frag-'));
  const file = path.join(dir, 'fragment.png');
  try {
    await fs.writeFile(file, Buffer.from(pngBase64, 'base64'));
    const prompt =
      'Look at the image file and describe in one short noun phrase (max 12 words) what visual object ' +
      'this part shows, including its shape and current colour, e.g. "a round red apple body with a glossy highlight".';
    const schema = { type: 'object', properties: { description: { type: 'string' } }, required: ['description'] };
    const r = await callModel<{ description: string }>('model_4', {
      system: MODEL_4_SYSTEM,
      prompt,
      schema,
      imageFiles: [file],
      imageDir: dir,
    });
    const d = String(r.data?.description ?? '').trim();
    if (!d) throw new Error('model_4 returned an empty description');
    return d;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- model_5
const MODEL_5_SYSTEM =
  'You are model_5, an edge-conditioned image generator (like a ControlNet-conditioned diffusion model). ' +
  'You receive the edge geometry of a picture part (its shapes, without colours) and text prompts. For each ' +
  'prompt you paint the SAME geometry: you may only choose fill colour, stroke colour and a texture per shape; ' +
  'you can never change the shapes. Colours must be 6-digit hex (#rrggbb). Textures: none, stripes, dots, ' +
  'crosshatch, waves, grain. Variants for different prompts must be clearly distinguishable from each other. ' +
  'Respond only with JSON.';

export const TEXTURES = ['none', 'stripes', 'dots', 'crosshatch', 'waves', 'grain'] as const;

export interface EncodingPromptIn {
  value: string;
  prompt: string;
}
export interface ShapeStyle {
  gid: string;
  fill: string;
  stroke: string;
  texture: (typeof TEXTURES)[number];
  textureColor: string;
}

const HEX = /^#[0-9a-f]{6}$/i;

/** [model_5 generate]~ : encoding prompts + fragment edges -> categorical fragments */
export async function encodeFragment(
  edges: { gid: string; tag: string; bbox: [number, number, number, number] }[],
  prompts: EncodingPromptIn[],
): Promise<{ value: string; styles: ShapeStyle[] }[]> {
  const prompt =
    'Edge geometry (gid, tag, bbox [x, y, w, h]):\n' +
    edges.map((e) => `${e.gid}\t${e.tag}\t[${e.bbox.map((v) => Math.round(v)).join(', ')}]`).join('\n') +
    '\n\nPrompts (one variant per prompt):\n' +
    prompts.map((p, i) => `${i + 1}. [value=${p.value}] ${p.prompt}`).join('\n') +
    '\n\nReturn one variant per prompt with a style for every gid.';
  const schema = {
    type: 'object',
    properties: {
      variants: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            value: { type: 'string' },
            styles: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  gid: { type: 'string' },
                  fill: { type: 'string' },
                  stroke: { type: 'string' },
                  texture: { type: 'string', enum: [...TEXTURES] },
                  textureColor: { type: 'string' },
                },
                required: ['gid', 'fill'],
              },
            },
          },
          required: ['value', 'styles'],
        },
      },
    },
    required: ['variants'],
  };
  const r = await callModel<{ variants: { value: string; styles: Partial<ShapeStyle>[] }[] }>('model_5', {
    system: MODEL_5_SYSTEM,
    prompt,
    schema,
    timeoutMs: 240_000,
  });
  const gids = new Set(edges.map((e) => e.gid));
  const byValue = new Map((r.data?.variants ?? []).map((v) => [String(v.value), v]));
  // validation: one variant per requested value, a style for every gid, hex colours, known textures
  return prompts.map((p, i) => {
    const v = byValue.get(p.value) ?? r.data?.variants?.[i];
    if (!v) throw new Error(`model_5 returned no variant for "${p.value}"`);
    const styles: ShapeStyle[] = [];
    const seen = new Map(v.styles.map((s) => [String(s.gid), s]));
    for (const gid of gids) {
      const s = seen.get(gid) ?? v.styles[0];
      if (!s) throw new Error(`model_5 variant "${p.value}" has no styles`);
      styles.push({
        gid,
        fill: HEX.test(String(s.fill)) ? String(s.fill) : '#999999',
        stroke: HEX.test(String(s.stroke)) ? String(s.stroke) : '#333333',
        texture: (TEXTURES as readonly string[]).includes(String(s.texture)) ? (s.texture as ShapeStyle['texture']) : 'none',
        textureColor: HEX.test(String(s.textureColor)) ? String(s.textureColor) : '#000000',
      });
    }
    return { value: p.value, styles };
  });
}
