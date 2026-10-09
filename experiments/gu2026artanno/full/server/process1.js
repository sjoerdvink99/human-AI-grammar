// Process 1 — Prepare artwork data.
// (artworks_1)* + (artwork_metadata_1)* -> [tool_1 extract] -> + (bounding_boxes_1)* + (basic_labels_1)*
// -> [model_1 generate]~ -> + (artwork_descriptions_1)* + (unit_descriptions_1)*
import { z } from 'zod';
import { callModelJson } from './llm.js';
import { imagePath, save } from './store.js';

export const BASIC_LABELS = ['person', 'bird', 'crane', 'duck', 'fish', 'bat', 'deer', 'animal', 'flower', 'blossom', 'tree', 'pine',
  'bamboo', 'plant', 'fruit', 'peach', 'rock', 'mountain', 'water', 'wave', 'cloud', 'sun', 'moon', 'snow', 'vase', 'vessel',
  'building', 'boat', 'text', 'other'];

const Box = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });
const DetectSchema = z.object({ regions: z.array(z.object({ label: z.string(), box: Box })).min(1).max(12) });

const clamp = (v) => Math.min(1, Math.max(0, v));

/** tool_1 extract: object detection (vision call substituting for a detector) → bounding_boxes + basic_labels. */
export async function detectRegions(artwork) {
  const out = await callModelJson({
    system: 'You are an object detector. You output bounding boxes and a basic object class for every distinct depicted object. You do not interpret meaning.',
    prompt: `Detect the distinct depicted objects in the image. Use only these classes: ${BASIC_LABELS.join(', ')}.
Group many identical small items (e.g. snowflakes) into one region. Return at most 10 regions.
Boxes are normalised to the image size: x,y = top-left corner, w,h = width/height, all between 0 and 1.
JSON: {"regions":[{"label":"crane","box":{"x":0.5,"y":0.4,"w":0.3,"h":0.4}}]}`,
    images: [imagePath(artwork)],
    schema: DetectSchema,
  });
  return out.regions.map((r, i) => {
    const x = clamp(r.box.x), y = clamp(r.box.y);
    return {
      id: `${artwork.id}.u${i + 1}`,
      box: { x, y, w: clamp(Math.min(r.box.w, 1 - x)), h: clamp(Math.min(r.box.h, 1 - y)) },
      basicLabel: BASIC_LABELS.includes(r.label) ? r.label : 'other', // categorical: enforced fixed set
    };
  });
}

const DescribeSchema = z.object({
  artwork_description: z.string().min(20),
  units: z.array(z.object({ id: z.string(), description: z.string().min(5) })),
});

/** model_1 generate~: artwork-level and unit-level descriptions from image + metadata + regions. */
export async function describeArtwork(artwork, units) {
  const out = await callModelJson({
    system: 'You are an art historian writing neutral visual descriptions for an annotation dataset. Describe what is depicted and how (motifs, colour, composition, medium), and note conventional cultural associations only when they are well established. Be concise.',
    prompt: `Artwork metadata: ${JSON.stringify(artwork.metadata)}
Detected regions (normalised boxes):
${units.map((u) => `${u.id}: ${u.basicLabel} at ${JSON.stringify(u.box)}`).join('\n')}

Write (1) a 2–4 sentence description of the whole artwork and (2) a one or two sentence description of each region, by id.
JSON: {"artwork_description":"...","units":[{"id":"${units[0]?.id}","description":"..."}]}`,
    images: [imagePath(artwork)],
    schema: DescribeSchema,
    check: (v) => {
      const missing = units.filter((u) => !v.units.find((x) => x.id === u.id)).map((u) => u.id);
      return missing.length ? `missing unit descriptions for ${missing.join(', ')}` : null;
    },
  });
  return {
    description: out.artwork_description,
    units: units.map((u) => ({ ...u, description: out.units.find((x) => x.id === u.id).description })),
  };
}

/** Run process 1 for one artwork, updating status for the UI. */
export async function prepareArtwork(artwork, onStep = () => {}) {
  artwork.status = 'detecting'; artwork.error = null; save(); onStep('tool_1 extract');
  try {
    const units = await detectRegions(artwork);
    artwork.units = units; artwork.status = 'describing'; save(); onStep('model_1 generate');
    const d = await describeArtwork(artwork, units);
    artwork.description = d.description; artwork.units = d.units; artwork.status = 'ready';
  } catch (e) {
    artwork.status = 'error'; artwork.error = e.message;
  }
  save();
  return artwork;
}
