// model_2: image generation and editing model.
// Realized with the Claude CLI drawing SVG, which is then rasterized (no image-generation API is available).
// Replace the bodies here with calls to a raster image model to swap providers.
import { callModel } from '../llm.js';
import { rasterizeSvg, type RGBA } from '../tools/raster.js';

const SYSTEM =
  'You are the image generation and editing component (model_2) of a layered cut-art design tool. ' +
  'You produce images as complete, self-contained SVG documents: flat illustration style with clearly separated, solid shapes, ' +
  'rich but limited palettes, simple gradients allowed, no text unless asked, no external references, no <image>, no <script>, no filters. ' +
  'Answer only with the requested JSON.';

const svgSchema = {
  type: 'object',
  properties: { svg: { type: 'string' }, caption: { type: 'string' } },
  required: ['svg'],
};

/** Validate and sanitize a model SVG; throws if unusable. */
export function sanitizeSvg(svg: string, w: number, h: number): string {
  let s = svg.trim();
  const start = s.indexOf('<svg');
  const end = s.lastIndexOf('</svg>');
  if (start < 0 || end < 0) throw new Error('model did not return an SVG document');
  s = s.slice(start, end + 6);
  s = s.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<image[\s\S]*?(\/>|<\/image>)/gi, '').replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '');
  s = s.replace(/\son\w+="[^"]*"/gi, '').replace(/(href)="(?!#)[^"]*"/gi, '');
  if (!/xmlns=/.test(s)) s = s.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  if (!/viewBox=/.test(s)) s = s.replace('<svg', `<svg viewBox="0 0 ${w} ${h}"`);
  s = s.replace(/<svg([^>]*?)\swidth="[^"]*"/, '<svg$1').replace(/<svg([^>]*?)\sheight="[^"]*"/, '<svg$1');
  s = s.replace('<svg', `<svg width="${w}" height="${h}"`);
  return s;
}

async function drawSvg(prompt: string, w: number, h: number, images?: string[]): Promise<RGBA> {
  const r = await callModel<{ svg: string }>({ role: 'model_2', system: SYSTEM, schema: svgSchema, prompt, images, timeoutMs: 300_000 });
  return rasterizeSvg(sanitizeSvg(r.svg, w, h), w, h);
}

const VARIATIONS = ['a balanced, classic composition', 'a bolder composition with strong silhouettes', 'a softer, more atmospheric composition'];

/** [model_2 generate]~  prompt → image_candidates (process 1) */
export async function generateCandidates(prompt: string, n = 3, size = 768): Promise<RGBA[]> {
  return Promise.all(
    Array.from({ length: n }, (_, i) =>
      drawSvg(
        `Create an SVG illustration (viewBox 0 0 ${size} ${size}) of: "${prompt}".\n` +
          `Variation: ${VARIATIONS[i % VARIATIONS.length]}. The scene should have clear depth (foreground, middle ground, background) ` +
          `with distinct objects so it can be split into stacked layers. Fill the whole canvas with a background.`,
        size,
        size,
      ),
    ),
  );
}

/** [model_2 modify]~  source_image + image_update → source_image (new version) (process 2) */
export async function editImage(imagePath: string, w: number, h: number, instruction: string): Promise<RGBA> {
  return drawSvg(
    `Redraw the entire image you are shown as an SVG (viewBox 0 0 ${w} ${h}), applying this change: "${instruction}".\n` +
      `Preserve the composition, positions, colours and content of everything the change does not touch.`,
    w,
    h,
    [imagePath],
  );
}

/**
 * [model_2 modify]~  work_image + fill_prompt → work_image (process 4 inpainting).
 * The model sees the image with the hole painted magenta and returns an SVG patch for the hole.
 */
export async function inpaintPatch(holeImagePath: string, w: number, h: number, fillPrompt: string, style: string): Promise<RGBA> {
  return drawSvg(
    `The image (${w}x${h} px) has regions painted pure magenta (#ff00ff); they must be filled in.\n` +
      `Fill instruction: ${fillPrompt}\nStyle: ${style}\n` +
      `Return an SVG (viewBox 0 0 ${w} ${h}, transparent background) that paints ONLY over the magenta regions (slightly beyond their edges is fine), ` +
      `continuing the surrounding scene: match the colours, horizon lines, and shapes that meet the region boundary. Do not paint elsewhere.`,
    w,
    h,
    [holeImagePath],
  );
}

/**
 * [model_2 generate]~  element crop → isolated element on a plain white background
 * (process 5 fallback, process 8 repair, process 6 completion). Output keeps the crop's size/framing.
 */
export async function isolateOnWhite(imagePath: string, w: number, h: number, what: string, complete: boolean): Promise<RGBA> {
  return drawSvg(
    `Redraw ONLY the ${what} shown in this image as an SVG (viewBox 0 0 ${w} ${h}) on a pure white (#ffffff) background.\n` +
      `Keep it at exactly the same position, size and pose as in the image, with clean, crisp edges and its original colours. ` +
      (complete ? 'If parts of it are hidden or cut off, complete them plausibly. ' : '') +
      `Remove everything else (background, other objects, shadows). Do not use white inside the object; use off-white (#f4f1ea) for white areas.`,
    w,
    h,
    [imagePath],
  );
}

/** [model_2 generate]~  grab_request → grab_candidates (process 6) */
export async function generateGrabCandidates(request: string, style: string | undefined, n = 3, size = 512): Promise<RGBA[]> {
  return Promise.all(
    Array.from({ length: n }, (_, i) =>
      drawSvg(
        `Create an SVG (viewBox 0 0 ${size} ${size}) showing a single object: "${request}". ` +
          `Variation: ${VARIATIONS[i % VARIATIONS.length]}. ` +
          (style ? `Match this style: ${style}. ` : '') +
          `Show it in a natural setting with a simple background; the object should be large and central.`,
        size,
        size,
      ),
    ),
  );
}
