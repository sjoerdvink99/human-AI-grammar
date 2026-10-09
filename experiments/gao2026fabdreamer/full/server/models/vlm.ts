// model_1: vision-language model. One prompt per operation in the design.
import { callModel } from '../llm.js';
import type { Box, DetectionPrompt, LayerItem, LayerPlan } from '../../shared/types.js';

const SYSTEM =
  'You are the vision-language component (model_1) of a tool that turns a picture into a layered, laser-cut paper/wood artwork. ' +
  'Layers are physical sheets stacked front to back; depth 0 is the front-most sheet and the highest depth is the back plate. ' +
  'Answer only with the requested JSON.';

const planSchema = {
  type: 'object',
  properties: {
    layers: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          depth: { type: 'integer' },
          elements: {
            type: 'array',
            items: {
              type: 'object',
              properties: { name: { type: 'string' }, description: { type: 'string' } },
              required: ['name', 'description'],
            },
          },
        },
        required: ['name', 'depth', 'elements'],
      },
    },
    message: { type: 'string' },
  },
  required: ['layers', 'message'],
};

type RawPlan = { layers: { name: string; depth: number; elements: { name: string; description: string }[] }[]; message: string };

/** Make a validated LayerPlan: contiguous depths, unique ids, back layer present. */
export function normalizePlan(raw: RawPlan): LayerPlan {
  const layers = [...raw.layers]
    .filter((l) => l && Array.isArray(l.elements))
    .sort((a, b) => a.depth - b.depth)
    .slice(0, 8)
    .map((l, i) => ({
      id: `L${i}`,
      name: String(l.name || `Layer ${i + 1}`),
      depth: i,
      elements: l.elements.slice(0, 12).map((e, j) => ({
        id: `L${i}E${j}`,
        name: String(e.name || `element ${j + 1}`),
        description: String(e.description || ''),
      })),
    }));
  if (layers.length < 2) throw new Error('layer plan must have at least two layers');
  return { layers };
}

/** [model_1 generate]~  source_image → layer_plan (process 3) */
export async function proposeLayers(imagePath: string, w: number, h: number) {
  const raw = await callModel<RawPlan>({
    role: 'model_1',
    system: SYSTEM,
    images: [imagePath],
    schema: planSchema,
    prompt:
      `Look at the image (${w}x${h} px). Propose a depth-ordered layer structure for turning it into a stacked layered cut artwork.\n` +
      `Use 3 to 5 layers. Depth 0 is the front. The deepest layer is the background/back plate and should contain one element describing the remaining background.\n` +
      `Every other layer lists the distinct, visible, cuttable objects on it (people, animals, trees, buildings, foreground plants, clouds, …). Put objects that occlude others in front of them.\n` +
      `Each element needs a short name and a one-sentence description of where it is and what it looks like.\n` +
      `In "message" give a one-sentence summary for the user.`,
  });
  return { plan: normalizePlan(raw), message: raw.message };
}

/** [model_1 modify]~  source_image + layer_plan + layer_change → layer_plan (process 3 loop) */
export async function reviseLayers(imagePath: string, w: number, h: number, plan: LayerPlan, change: string) {
  const raw = await callModel<RawPlan>({
    role: 'model_1',
    system: SYSTEM,
    images: [imagePath],
    schema: planSchema,
    prompt:
      `Image size ${w}x${h} px. Current layer plan (depth 0 = front):\n${JSON.stringify(stripIds(plan), null, 1)}\n\n` +
      `The user requests this change: "${change}"\n` +
      `Return the full revised plan. Keep everything the user did not ask to change. If they mention an element you overlooked, add it to the layer that fits its depth. ` +
      `Keep a background layer at the deepest depth. In "message" say briefly what you changed.`,
  });
  return { plan: normalizePlan(raw), message: raw.message };
}

const stripIds = (plan: LayerPlan) =>
  plan.layers.map((l) => ({ name: l.name, depth: l.depth, elements: l.elements.map((e) => ({ name: e.name, description: e.description })) }));

/** [model_1 extract]  source_image + confirmed_layers → layer_items (process 4) */
export async function describeItems(imagePath: string, plan: LayerPlan): Promise<LayerItem[]> {
  const r = await callModel<{ items: { elementId: string; visualDetails: string }[] }>({
    role: 'model_1',
    system: SYSTEM,
    images: [imagePath],
    schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: { elementId: { type: 'string' }, visualDetails: { type: 'string' } },
            required: ['elementId', 'visualDetails'],
          },
        },
      },
      required: ['items'],
    },
    prompt:
      `For each element of this confirmed layer plan, describe precisely what it looks like in the image (shape, colours, extent, position) so a segmentation step can find exactly that object.\n` +
      JSON.stringify(plan.layers.map((l) => ({ layer: l.name, depth: l.depth, elements: l.elements })), null, 1) +
      `\nReturn one item per elementId.`,
  });
  const byId = new Map(r.items.map((i) => [i.elementId, i.visualDetails]));
  return plan.layers.flatMap((l) =>
    l.elements.map((e) => ({ id: e.id, layerId: l.id, name: e.name, description: e.description, visualDetails: byId.get(e.id) ?? e.description })),
  );
}

/** [model_1 extract]  source_image + layer_items → style (process 4) */
export async function describeStyle(imagePath: string): Promise<string> {
  const r = await callModel<{ style: string }>({
    role: 'model_1',
    system: SYSTEM,
    images: [imagePath],
    schema: { type: 'object', properties: { style: { type: 'string' } }, required: ['style'] },
    prompt: 'Describe the visual style of this image in 2-3 sentences: medium (photo, illustration, …), palette, lighting, texture, level of detail.',
  });
  return r.style;
}

const boxesSchema = {
  type: 'object',
  properties: {
    detections: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          itemId: { type: 'string' },
          label: { type: 'string' },
          box: { type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 4 },
        },
        required: ['itemId', 'label', 'box'],
      },
    },
  },
  required: ['detections'],
};

/** [model_1 extract]  work_image + layer_items → detection_prompts (process 4, per layer) */
export async function locateElements(imagePath: string, w: number, h: number, items: LayerItem[]): Promise<DetectionPrompt[]> {
  const r = await callModel<{ detections: DetectionPrompt[] }>({
    role: 'model_1',
    system: SYSTEM,
    images: [imagePath],
    schema: boxesSchema,
    prompt:
      `The image is ${w}x${h} pixels (origin top-left). Locate each of these elements and give a tight bounding box [x0, y0, x1, y1] in pixel coordinates.\n` +
      `If an element appears several times, return one detection per instance (same itemId). Omit elements that are not visible.\n` +
      JSON.stringify(items.map((i) => ({ itemId: i.id, name: i.name, looksLike: i.visualDetails }))),
  });
  return sanitizeDetections(r.detections, w, h, new Set(items.map((i) => i.id)));
}

/** [model_1 extract]  split_target + split_request → part_prompts (process 9) */
export async function locateParts(imagePath: string, w: number, h: number, request: string, elementName: string): Promise<DetectionPrompt[]> {
  const r = await callModel<{ detections: DetectionPrompt[] }>({
    role: 'model_1',
    system: SYSTEM,
    images: [imagePath],
    schema: boxesSchema,
    prompt:
      `This image (${w}x${h} px, transparent/white background) shows the element "${elementName}". The user asks: "${request}".\n` +
      `Identify the sub-parts the user wants separated and give a tight bounding box [x0,y0,x1,y1] in pixels for each. Use itemId "part0", "part1", … and a short label. ` +
      `Together the parts should cover the whole element; include a part for the remainder if needed.`,
  });
  return sanitizeDetections(r.detections, w, h);
}

function sanitizeDetections(d: DetectionPrompt[], w: number, h: number, allowed?: Set<string>): DetectionPrompt[] {
  return d
    .filter((x) => Array.isArray(x.box) && x.box.length === 4 && x.box.every((n) => Number.isFinite(n)))
    .filter((x) => !allowed || allowed.has(x.itemId))
    .map((x) => {
      const b = x.box;
      const box: Box = [
        Math.max(0, Math.min(b[0], b[2])),
        Math.max(0, Math.min(b[1], b[3])),
        Math.min(w, Math.max(b[0], b[2])),
        Math.min(h, Math.max(b[1], b[3])),
      ];
      return { ...x, box };
    })
    .filter((x) => x.box[2] - x.box[0] >= 4 && x.box[3] - x.box[1] >= 4);
}

/** [model_1 generate]~  work_image + layer_items + style + segments → fill_prompt (process 4) */
export async function fillPrompt(holeImagePath: string, style: string, removed: string[], remainingLayers: string[]): Promise<string> {
  const r = await callModel<{ fillPrompt: string }>({
    role: 'model_1',
    system: SYSTEM,
    images: [holeImagePath],
    schema: { type: 'object', properties: { fillPrompt: { type: 'string' } }, required: ['fillPrompt'] },
    prompt:
      `The magenta regions in this image are where these elements were removed: ${removed.join(', ')}.\n` +
      `Image style: ${style}\nLayers still behind them: ${remainingLayers.join(', ') || 'background only'}.\n` +
      `Write a short prompt (1-2 sentences) for an image model telling it what should be painted into the magenta regions so that the scene behind continues naturally (do not mention the removed objects).`,
  });
  return r.fillPrompt;
}

/** [model_1 evaluate]  grab_image → occlusion (process 6) */
export async function evaluateOcclusion(imagePath: string, request: string): Promise<'occluded' | 'complete'> {
  const r = await callModel<{ occlusion: 'occluded' | 'complete'; reason: string }>({
    role: 'model_1',
    system: SYSTEM,
    images: [imagePath],
    schema: {
      type: 'object',
      properties: { occlusion: { type: 'string', enum: ['occluded', 'complete'] }, reason: { type: 'string' } },
      required: ['occlusion', 'reason'],
    },
    prompt: `The image should show: "${request}". Is that object partly hidden (cut off by the frame or covered by something), or fully visible? Answer "occluded" or "complete".`,
  });
  return r.occlusion === 'occluded' ? 'occluded' : 'complete';
}
