// Process 1: artworks_1 + artwork_metadata_1 -> [tool_1 extract] -> boxes + basic labels
//            -> [model_1 generate]~ -> artwork_descriptions_1 + unit_descriptions_1
import { callModel } from '../llm.js';
import { load, save } from '../store.js';
import { tool1Extract } from '../tools/extract.js';
import { imagePathFor } from '../tools/images.js';
import { runStep } from '../jobs.js';

export const P1_STEPS = ['tool_1 extract', 'model_1 generate~'];

const SYSTEM_1 = `You are model_1, an art-historical describer. You look at one artwork image and write
(a) a short description of the whole artwork and (b) a description of each annotated unit (a bounding box).
Describe what is visibly depicted: kind of thing, pose or gesture, clothing colour, held objects, symbolic
markers (halo, cross, star), position in the scene and relation to other units. Do not invent provenance.
Unit descriptions: 1-2 sentences each. Artwork description: 2-4 sentences.`;

const SCHEMA_1 = {
  type: 'object',
  properties: {
    artworkDescription: { type: 'string' },
    units: { type: 'array', items: { type: 'object', properties: { unitId: { type: 'string' }, description: { type: 'string' } }, required: ['unitId', 'description'] } },
  },
  required: ['artworkDescription', 'units'],
};

/** model_1 generate~ for one artwork. Input: the image, its boxes and basic labels (preceding state). */
export async function model1Describe({ artwork, metadata, boxes, basicLabels, imagePath }) {
  const unitLines = boxes.map((b) => `- ${b.unitId}: basic label "${basicLabels.find((l) => l.unitId === b.unitId)?.label}", box x=${b.x} y=${b.y} w=${b.w} h=${b.h} (pixels, origin top-left, image ${artwork.width}x${artwork.height})`).join('\n');
  const prompt = `Artwork "${metadata.title}" by ${metadata.artist}, ${metadata.year}, ${metadata.medium}.
Annotated units:
${unitLines}

Return a description of the artwork and one description per unit id listed above (all of them, ids unchanged).`;
  const ids = new Set(boxes.map((b) => b.unitId));
  return callModel({
    role: 'model_1', system: SYSTEM_1, prompt, schema: SCHEMA_1, images: [imagePath],
    validate: (o) => {
      const got = new Set(o.units.map((u) => u.unitId));
      const missing = [...ids].filter((id) => !got.has(id));
      return missing.length ? `missing descriptions for ${missing.join(', ')}` : null;
    },
  });
}

export async function runProcess1(job) {
  const s = load();
  const toPath = imagePathFor(s.artworks);
  await runStep(job, 'tool_1 extract', async () => {
    const { boundingBoxes, basicLabels, errors } = tool1Extract(s.artworks, s.artworkMetadata);
    s.boundingBoxes = boundingBoxes;
    s.basicLabels = basicLabels;
    save();
    return { __detail: `${boundingBoxes.length} units${errors.length ? `, ${errors.length} skipped` : ''}` };
  });
  await runStep(job, 'model_1 generate~', async (progress) => {
    const pending = s.artworks.filter((a) => !s.artworkDescriptions.some((d) => d.artworkId === a.id) || job.force);
    let done = 0;
    const failures = [];
    await Promise.all(pending.map(async (artwork) => {
      const boxes = s.boundingBoxes.filter((b) => b.artworkId === artwork.id);
      try {
        const out = await model1Describe({
          artwork, metadata: s.artworkMetadata.find((m) => m.artworkId === artwork.id), boxes,
          basicLabels: s.basicLabels, imagePath: toPath(artwork.id),
        });
        s.artworkDescriptions = s.artworkDescriptions.filter((d) => d.artworkId !== artwork.id);
        s.artworkDescriptions.push({ artworkId: artwork.id, text: out.artworkDescription });
        const ids = new Set(boxes.map((b) => b.unitId));
        s.unitDescriptions = s.unitDescriptions.filter((d) => !ids.has(d.unitId));
        for (const u of out.units) if (ids.has(u.unitId)) s.unitDescriptions.push({ unitId: u.unitId, text: u.description });
        save();
      } catch (e) {
        failures.push(`${artwork.id}: ${e.message}`);
      }
      progress(`${++done}/${pending.length} artworks described`);
    }));
    if (failures.length) throw new Error(`model_1 failed for ${failures.length} artwork(s): ${failures[0]}`);
    return { __detail: `${pending.length} artworks described` };
  });
}
