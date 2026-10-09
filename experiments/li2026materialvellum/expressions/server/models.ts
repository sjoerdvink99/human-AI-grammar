/**
 * Every model operation in the design: one prompt per operation, built only from the
 * representations in the state that precedes it.
 *
 * model_1 = image generator (conditioned generation and inpainting; produces SVG here)
 * model_2 = text writer (poster copy)
 */
import { z } from 'zod';
import { callModel } from './llm.js';
import { assertWellFormed, normalizeSvg, sanitizeSvgFragment, SVG_NS } from './svg.js';
import {
  TEXT_ROLES,
  type GenerateIkebanaReq,
  type GenerateRenderReq,
  type InpaintRenderReq,
  type PosterImagesReq,
  type PosterImagesRes,
  type PosterTextReq,
  type PosterTextRes,
  type SvgRes,
} from '../src/shared/api.js';

// model_1's shared configuration: one "image model" with a fixed rendering persona.
const MODEL_1_SYSTEM = `You are model_1, an image-generation model in a design studio. You cannot output pixels, so you
output images as a single self-contained SVG document. Your images are rich, painterly and detailed:
use gradients (defined in <defs> and referenced with url(#id)), layered shapes, soft shadows and texture
made from many small shapes. Never use <script>, <foreignObject>, external links, embedded raster images or <text>.
Follow the conditioning input (maps, masks) exactly: structure in the image must line up with it.
Return only the JSON object requested.`;

const svgSchema = { type: 'object', properties: { svg: { type: 'string' } }, required: ['svg'] };
const svgZ = z.object({ svg: z.string().min(20) });

/** Generative-output validation: one automatic retry when the model returns something that is not a usable SVG. */
async function withSvgRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    console.warn(`${label}: invalid output, retrying once —`, (e as Error).message);
    return fn();
  }
}

// ---------- process 1: [model_1 generate]~  depth_map_1 -> render_1 ----------
export async function model1GenerateRender(req: GenerateRenderReq): Promise<SvgRes> {
  const d = req.depth_map;
  if (d.levels.length !== d.grid * d.grid) throw new Error('depth_map has the wrong number of cells');
  const rows: string[] = [];
  for (let r = 0; r < d.grid; r++) rows.push(d.levels.slice(r * d.grid, (r + 1) * d.grid).join(''));
  const cell = d.width / d.grid;
  const prompt = `Conditioning input: a top-down DEPTH MAP of a city district seen straight from above
(like a ControlNet depth condition). It is a ${d.grid}x${d.grid} grid; each digit is one cell of ${cell}x${cell} px
on a ${d.width}x${d.height} px image. 0 = ground level (streets, open land, water), 1-9 = building roof heights,
9 ≈ ${d.maxHeightM} m. Row 1 is the top of the image.

${rows.map((r, i) => `${String(i + 1).padStart(2, ' ')} ${r}`).join('\n')}

Generate a ${d.width}x${d.height} SVG (viewBox="0 0 ${d.width} ${d.height}") that is a beautiful aerial
architectural rendering of this district at golden hour, seen from directly above. Every non-zero cell must be
covered by a building roof with the footprint shown in the map; taller buildings get lighter roofs, rooftop
details and longer shadows cast toward the bottom-right. Zero cells are streets, plazas, lawns or water —
infer which from context (long straight runs of 0 are streets). Return {"svg": "<svg ...>...</svg>"}.`;
  return withSvgRetry('generate-render', async () => {
    const out = await callModel({ role: 'model_1', system: MODEL_1_SYSTEM, prompt, jsonSchema: svgSchema, validate: svgZ });
    return { svg: normalizeSvg(out.svg, d.width, d.height) };
  });
}

// ---------- process 1: [model_1 modify]~  render_1 + inpainting_masks_1 + function_prompts_1 -> render_2 ----------
const patchesZ = z.object({
  patches: z.array(z.object({ maskId: z.string(), svg: z.string() })),
});
export async function model1InpaintRender(req: InpaintRenderReq): Promise<SvgRes> {
  const { render, inpainting_masks: masks, function_prompts: prompts } = req;
  if (!masks.length) throw new Error('No inpainting masks');
  const prompt = `Inpainting task. Below is the current image (SVG, ${render.width}x${render.height}) and a set of circular
masks. Inside each mask, repaint the image so the area becomes what the mask's prompt asks for, blending with
the surrounding style, light direction and scale of the existing image. Outside the masks nothing changes.

Masks and prompts:
${masks
  .map((m) => `- mask "${m.id}": circle centre (${Math.round(m.cx)}, ${Math.round(m.cy)}), radius ${Math.round(m.r)} px. Prompt: ${prompts.find((p) => p.maskId === m.id)?.text ?? ''}`)
  .join('\n')}

Current image:
${render.svg}

For each mask return an SVG fragment (elements only, no <svg> root) in the image's coordinate system. The fragment
must start with a shape that fully covers its circle (the repainted ground), then the new content. It will be
clipped to the circle. Define any gradients inside the fragment with ids prefixed by the mask id.
Return {"patches": [{"maskId": "...", "svg": "<g>...</g>"}]} with one entry per mask.`;
  return withSvgRetry('inpaint-render', async () => {
  const out = await callModel({
    role: 'model_1',
    system: MODEL_1_SYSTEM,
    prompt,
    jsonSchema: {
      type: 'object',
      properties: {
        patches: {
          type: 'array',
          items: { type: 'object', properties: { maskId: { type: 'string' }, svg: { type: 'string' } }, required: ['maskId', 'svg'] },
        },
      },
      required: ['patches'],
    },
    validate: patchesZ,
  });
  // Composite: the unchanged render (nested as-is) with each patch clipped to its mask.
  const base = normalizeSvg(render.svg, render.width, render.height);
  const defs: string[] = [];
  const layers: string[] = [];
  for (const m of masks) {
    const patch = out.patches.find((p) => p.maskId === m.id);
    if (!patch) continue;
    const frag = sanitizeSvgFragment(patch.svg);
    try {
      assertWellFormed(`<svg ${SVG_NS}>${frag}</svg>`);
    } catch (e) {
      console.warn(`patch for ${m.id} dropped:`, (e as Error).message);
      continue;
    }
    const cid = `clip-${m.id}`;
    defs.push(`<clipPath id="${cid}"><circle cx="${m.cx}" cy="${m.cy}" r="${m.r}"/></clipPath>`);
    layers.push(`<g clip-path="url(#${cid})">${frag}</g>`);
  }
  if (!layers.length) throw new Error('Model returned no usable patches for the masks');
  const svg = `<svg ${SVG_NS} viewBox="0 0 ${render.width} ${render.height}" width="${render.width}" height="${render.height}">${base}<defs>${defs.join('')}</defs>${layers.join('')}</svg>`;
  assertWellFormed(svg);
  return { svg };
  });
}

// ---------- process 2: [model_1 generate]~  scribble_map_1 + ikebana_prompt_1 -> ikebana_image_1 ----------
export async function model1GenerateIkebana(req: GenerateIkebanaReq): Promise<SvgRes> {
  const s = req.scribble_map;
  const strokes = s.strokes
    .map((st, i) => `${i + 1}. width ${st.thickness}: ${st.points.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).join(' ')}`)
    .join('\n');
  const prompt = `Conditioning input 1 — SCRIBBLE MAP (like a ControlNet scribble condition): black lines on a white
${s.width}x${s.height} canvas, given as polylines (x,y in px, origin top-left):
${strokes}

Conditioning input 2 — TEXT PROMPT: ${req.ikebana_prompt}

Generate a ${s.width}x${s.height} SVG (viewBox="0 0 ${s.width} ${s.height}") of the image described by the prompt
whose main structures follow the scribble lines closely: each line becomes the stem, branch, leaf or blade the
prompt implies, each small closed loop becomes a blossom of that size. Paint a calm background and the vessel.
Return {"svg": "<svg ...>...</svg>"}.`;
  return withSvgRetry('generate-ikebana', async () => {
    const out = await callModel({ role: 'model_1', system: MODEL_1_SYSTEM, prompt, jsonSchema: svgSchema, validate: svgZ });
    return { svg: normalizeSvg(out.svg, s.width, s.height) };
  });
}

// ---------- process 3: [model_2 generate]~  poster_theme_1 + element_specs_1 -> text_elements_1 ----------
const MODEL_2_SYSTEM = `You are model_2, a concise poster copywriter. You write the text for the text elements of a poster
so that together they communicate the theme. Respect each element's role and character limit strictly.
Return only the JSON object requested.`;

const textsZ = z.object({ text_elements: z.array(z.object({ id: z.string(), text: z.string() })) });

export async function model2GeneratePosterText(req: PosterTextReq): Promise<PosterTextRes> {
  const textSpecs = req.element_specs.filter((s) => TEXT_ROLES.includes(s.role));
  if (!textSpecs.length) return { text_elements: [] };
  const prompt = `Poster theme: ${req.poster_theme}

Text elements to write (in reading order):
${textSpecs
  .sort((a, b) => a.order - b.order)
  .map((s) => `- id "${s.id}": role ${s.role}, area ${Math.round(s.bbox.w)}x${Math.round(s.bbox.h)} px, at most ${s.maxChars} characters`)
  .join('\n')}

Other elements on the poster: ${req.element_specs.filter((s) => !TEXT_ROLES.includes(s.role)).map((s) => `${s.role} (${s.id})`).join(', ') || 'none'}.
Roles: title = short headline; subtitle = one supporting line; body = 1–3 informative sentences; date = a date/time
line; caption = a short label. Return {"text_elements": [{"id": "...", "text": "..."}]} with one entry per id above.`;
  const out = await callModel({
    role: 'model_2',
    system: MODEL_2_SYSTEM,
    prompt,
    jsonSchema: {
      type: 'object',
      properties: {
        text_elements: {
          type: 'array',
          items: { type: 'object', properties: { id: { type: 'string' }, text: { type: 'string' } }, required: ['id', 'text'] },
        },
      },
      required: ['text_elements'],
    },
    validate: textsZ,
  });
  // validate coverage and enforce the character limits where the representation is produced
  const text_elements = textSpecs.map((s) => {
    const t = out.text_elements.find((e) => e.id === s.id)?.text?.trim();
    if (!t) throw new Error(`model_2 did not write text for element ${s.id}`);
    const max = s.maxChars ?? 200;
    return { id: s.id, text: t.length > max ? t.slice(0, max - 1).replace(/\s+\S*$/, '') + '…' : t };
  });
  return { text_elements };
}

// ---------- process 3: [model_1 generate]~  element_specs_1 + text_elements_1 -> image_elements_1 ----------
const imagesZ = z.object({ image_elements: z.array(z.object({ id: z.string(), svg: z.string() })) });

export async function model1GeneratePosterImages(req: PosterImagesReq): Promise<PosterImagesRes> {
  const imageSpecs = req.element_specs.filter((s) => s.role === 'image');
  if (!imageSpecs.length) return { image_elements: [] };
  const theme = imageSpecs[0].theme;
  const prompt = `Generate the illustrations for a poster.
Poster theme: ${theme}
Poster text already written: ${req.text_elements.map((t) => `"${t.text}"`).join(' / ') || '(none)'}

Images to generate:
${imageSpecs.map((s) => `- id "${s.id}": ${Math.round(s.bbox.w)}x${Math.round(s.bbox.h)} px, reading order ${s.order}`).join('\n')}

Each image is its own SVG document with viewBox="0 0 W H" for its own size, illustrating the theme in a style that
fits the poster text; if there are several, make them complementary. Return {"image_elements": [{"id": "...", "svg": "<svg ...>...</svg>"}]}.`;
  return withSvgRetry('generate-poster-images', async () => {
  const out = await callModel({
    role: 'model_1',
    system: MODEL_1_SYSTEM,
    prompt,
    jsonSchema: {
      type: 'object',
      properties: {
        image_elements: {
          type: 'array',
          items: { type: 'object', properties: { id: { type: 'string' }, svg: { type: 'string' } }, required: ['id', 'svg'] },
        },
      },
      required: ['image_elements'],
    },
    validate: imagesZ,
  });
  return {
    image_elements: imageSpecs.map((s) => {
      const e = out.image_elements.find((i) => i.id === s.id);
      if (!e) throw new Error(`model_1 did not generate image ${s.id}`);
      return { id: s.id, svg: normalizeSvg(e.svg, Math.round(s.bbox.w), Math.round(s.bbox.h)) };
    }),
  };
  });
}
