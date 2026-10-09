import { Router } from 'express';
import { callModel, extractJson } from './model.js';
import { extractSvg, ensureViewBox, stripBackground } from './svg.js';
import type {
  UrbanRenderReq, UrbanInpaintReq, UrbanInpaintRes, IkebanaReq, PosterTextReq, PosterTextRes,
  PosterImageReq, PosterImageRes, SvgRes, ElementSpec,
} from '../src/shared/api.js';

export const router = Router();

// ---- model_1: the "image model". The design specifies a diffusion model with
// ControlNet Depth/Scribble and LayerDiffuse; here Claude emits SVG under the
// same conditioning contract.
const MODEL_1_SYSTEM = `You are an image generator that outputs a single standalone SVG document and nothing else.
You follow spatial conditioning exactly (like a ControlNet): shapes must sit where the conditioning puts them.
Rules: output only <svg>...</svg>; use xmlns="http://www.w3.org/2000/svg"; no scripts, no external images, no text unless asked; rich but compact (under 250 elements); use gradients and layered shapes for a painterly look.`;

// ---- model_2: the language model.
const MODEL_2_SYSTEM = `You are a poster copywriter. You write short, striking text for graphic posters and answer only in the JSON format requested.`;

function wrap<T>(fn: (body: any) => Promise<T>) {
  return async (req: any, res: any) => {
    try {
      res.json(await fn(req.body));
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: String(e?.message ?? e) });
    }
  };
}

function gridToText(g: number[][]): string {
  return g.map((row) => row.join('')).join('\n');
}

// process 1: depth_map_1 -> [model_1 generate]~ -> render_1
router.post('/urban/render', wrap<SvgRes>(async (b: UrbanRenderReq) => {
  const n = b.depthGrid.length;
  const prompt = `Depth conditioning (top-down orthographic depth map of a neighborhood, ${n}x${n} cells, each cell covers ${(b.size / n).toFixed(1)}px; digit 0 = ground level, 9 = tallest building; row 0 is the top of the image):
${gridToText(b.depthGrid)}

Generate a ${b.size}x${b.size} SVG (viewBox="0 0 ${b.size} ${b.size}") that is a photoreal-ish aerial illustration of this neighborhood seen from directly above at golden hour.
- Cells with depth 0 are streets, plazas, greenery or water; give streets a consistent asphalt grey and add trees in larger 0-areas.
- Cells with depth >0 are building roofs; taller (higher digit) roofs are lighter and cast longer soft shadows toward the bottom-right; low roofs are warm terracotta/grey, tall roofs are glass/concrete.
- Respect footprints: draw each roof as rectangles aligned with the cells it covers. Merge adjacent cells of equal height into one roof.`;
  const r = await callModel({ role: 'model_1', system: MODEL_1_SYSTEM, prompt });
  return { svg: ensureViewBox(extractSvg(r.text), b.size, b.size) };
}));

// process 1: render_1 + inpainting_masks_1 + function_prompts_1 -> [model_1 modify]~ -> render_2
router.post('/urban/inpaint', wrap<UrbanInpaintRes>(async (b: UrbanInpaintReq) => {
  if (!b.masks.length) return { patches: [] };
  const ctx = b.render.length > 40000 ? b.render.slice(0, 40000) + '\n<!-- truncated -->' : b.render;
  const regions = b.masks
    .map((m, i) => `- id "${m.id}": rectangle x=${m.x} y=${m.y} w=${m.w} h=${m.h}. Repaint as: ${b.prompts[i]}`)
    .join('\n');
  const prompt = `You are inpainting regions of an existing aerial neighborhood image (${b.size}x${b.size}).
Current image (SVG):
${ctx}

Masked regions to repaint:
${regions}

For each region return an SVG fragment (a <g> element in the full-image coordinate system) that fully covers its rectangle with the requested function, seen from directly above, matching the palette and lighting of the current image.
Answer with JSON only: {"patches":[{"id":"...","svg":"<g>...</g>"}]}`;
  const r = await callModel({
    role: 'model_1', system: MODEL_1_SYSTEM.replace('a single standalone SVG document and nothing else', 'SVG fragments inside JSON'), prompt,
    jsonSchema: {
      type: 'object',
      properties: { patches: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, svg: { type: 'string' } }, required: ['id', 'svg'] } } },
      required: ['patches'],
    },
  });
  const out = extractJson<UrbanInpaintRes>(r);
  const ids = new Set(b.masks.map((m) => m.id));
  const patches = out.patches
    .filter((p) => ids.has(p.id) && /<g[\s>]/i.test(p.svg))
    .map((p) => ({ id: p.id, svg: p.svg.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, '') }));
  if (!patches.length) throw new Error('model_1 returned no usable patches');
  return { patches };
}));

// process 2: scribble_map_1 + ikebana_prompt_1 -> [model_1 generate]~ -> ikebana_image_1
router.post('/ikebana/generate', wrap<SvgRes>(async (b: IkebanaReq) => {
  const s = b.scribble;
  const strokes = s.strokes.map((st) => `${st.kind}: ${st.points.map(([x, y]) => `${Math.round(x)},${Math.round(y)}`).join(' ')}`).join('\n');
  const circles = s.circles.map((c) => `${c.kind} at (${Math.round(c.cx)},${Math.round(c.cy)}) r=${Math.round(c.r)}`).join('\n');
  const prompt = `Scribble conditioning (line drawing, ${s.size}x${s.size}, origin top-left):
Polylines:
${strokes}
Circles (flower heads / leaf centres):
${circles}

Prompt: ${b.prompt}

Generate a ${s.size}x${s.size} SVG (viewBox="0 0 ${s.size} ${s.size}") that follows the scribble exactly: every stem along its polyline, every flower or leaf at its circle with roughly that size. Soft paper background, delicate botanical painting style.`;
  const r = await callModel({ role: 'model_1', system: MODEL_1_SYSTEM, prompt });
  return { svg: ensureViewBox(extractSvg(r.text), s.size, s.size) };
}));

// process 3: poster_theme_1 + element_specs_1 -> [model_2 generate]~ -> text_elements_1
router.post('/poster/text', wrap<PosterTextRes>(async (b: PosterTextReq) => {
  const textSpecs = b.specs.filter((s) => s.role === 'title' || s.role === 'subtitle' || s.role === 'body');
  if (!textSpecs.length) return { texts: [] };
  const lines = textSpecs.map((s) => {
    const maxWords = s.role === 'title' ? Math.max(1, Math.round(1 + s.size * 6)) : s.role === 'subtitle' ? Math.round(3 + s.size * 10) : Math.round(10 + s.size * 60);
    return `- clusterId "${s.clusterId}": ${s.role}, box ${Math.round(s.w)}x${Math.round(s.h)}px, visual weight ${s.weight.toFixed(2)}, at most ${maxWords} words. Request: ${s.request}`;
  }).join('\n');
  const prompt = `Poster theme: ${b.theme}

Write the text for each element:
${lines}

Answer with JSON only: {"texts":[{"clusterId":"...","text":"..."}]}`;
  const r = await callModel({
    role: 'model_2', system: MODEL_2_SYSTEM, prompt,
    jsonSchema: {
      type: 'object',
      properties: { texts: { type: 'array', items: { type: 'object', properties: { clusterId: { type: 'string' }, text: { type: 'string' } }, required: ['clusterId', 'text'] } } },
      required: ['texts'],
    },
  });
  const out = extractJson<PosterTextRes>(r);
  const ids = new Set(textSpecs.map((s) => s.clusterId));
  return { texts: out.texts.filter((t) => ids.has(t.clusterId) && t.text.trim()).map((t) => ({ ...t, text: t.text.trim() })) };
}));

// process 3: element_specs_1 + text_elements_1 -> [model_1 generate]~ -> image_elements_1
router.post('/poster/images', wrap<PosterImageRes>(async (b: PosterImageReq) => {
  const imgSpecs = b.specs.filter((s) => s.role === 'image' || s.role === 'decoration');
  const copy = b.texts.map((t) => `"${t.text}"`).join(' / ');
  const images = await Promise.all(imgSpecs.map(async (s: ElementSpec) => {
    const w = Math.max(16, Math.round(s.w));
    const h = Math.max(16, Math.round(s.h));
    const prompt = `Generate a ${w}x${h} SVG (viewBox="0 0 ${w} ${h}") with a TRANSPARENT background (no full-canvas background rect): an isolated ${s.role === 'image' ? 'illustration' : 'decorative graphic motif'} for a poster.
Request: ${s.request}
Visual weight ${s.weight.toFixed(2)} (0 = light, airy, thin lines; 1 = bold, dense, saturated).
Poster copy for context: ${copy || '(none)'}
Do not include any text.`;
    const r = await callModel({ role: 'model_1', system: MODEL_1_SYSTEM, prompt });
    return { clusterId: s.clusterId, svg: stripBackground(ensureViewBox(extractSvg(r.text), w, h), w, h) };
  }));
  return { images };
}));
