// One function per model step in the design. Each builds its prompt only from the
// representations in the state that precedes the step, and validates the output.
import { callModel } from './llm.mjs';
import { extractSvg, sanitizeSvg, tagElements, countShapes, parseJsonLoose } from './svg.mjs';

const ROLE_MODEL = {
  model_1: process.env.MODEL_1, // keyword generator
  model_2: process.env.MODEL_2, // pictorial image generator
  model_3: process.env.MODEL_3, // segmenter
  model_4: process.env.MODEL_4, // fragment describer
  model_5: process.env.MODEL_5, // categorical fragment generator
};

// ---- Process 1: [model_1 generate]~  dataset_description -> keyword_response
const KEYWORD_SYSTEM = `ROLE: KEYWORDS. You help a designer find visual metaphors for a dataset that will be
shown as pictorial glyphs (one small picture per data row). Given a description of a dataset, list 12-20 concrete,
drawable visual concepts (objects, creatures, plants, tools...) that relate to the dataset's theme and could serve as
a glyph whose parts encode attributes. Prefer concrete nouns of 1-3 words.
Output ONLY lines in the form: keyword | weight
where weight is an integer 1-10 for how fitting the concept is. No other text.`;

export async function generateKeywords(datasetDescription) {
  const text = await callModel({ system: KEYWORD_SYSTEM, prompt: datasetDescription, model: ROLE_MODEL.model_1 });
  if (!/\|/.test(text)) throw new Error('Keyword response was not in "keyword | weight" format');
  return text.trim();
}

// ---- Processes 1 and 2: [model_2 generate]~  image_prompt -> candidate image
const IMAGE_SYSTEM = `ROLE: IMAGE. You are an illustrator who draws pictorial glyphs as SVG code.
Rules for every drawing:
- Output ONLY one <svg> element with viewBox="0 0 256 256". No markdown, no explanation.
- Flat, simple, icon-like style with clear, visually separate parts (e.g. body, head, leaves, petals, handle),
  because each part will later be cut out and recoloured/resized to encode data.
- Draw each part as its own shape elements (path, circle, ellipse, rect, polygon). Use 8-40 shapes total.
- Do not use <text>, <image>, <use>, filters, scripts or external references. Avoid nested transforms.
- Centre the subject and leave a small margin; transparent background (no full-canvas background rect).`;

export async function generateImage(imagePrompt) {
  const raw = await callModel({ system: IMAGE_SYSTEM, prompt: imagePrompt, model: ROLE_MODEL.model_2 });
  const svg = tagElements(sanitizeSvg(extractSvg(raw), { viewBox: '0 0 256 256' }));
  if (countShapes(svg) < 2) throw new Error('Generated image had fewer than 2 shapes');
  return svg;
}

// ---- Process 4: [model_3 extract]  glyph_image + regions -> masks
const SEGMENT_SYSTEM = `ROLE: SEGMENT. You segment an SVG illustration into semantic parts.
You receive the SVG, a list of its shape elements (id, tag, fill, bounding box) and one or more rectangular regions
the user drew. For EACH region, return the ids of the shape elements that together form the meaningful object part the
user is pointing at (e.g. "the left wing", "all petals", "the hat"). Include parts partly outside the box if they
clearly belong to the same part; exclude background or unrelated shapes even when they overlap the box.
Output ONLY JSON: {"masks":[{"region":0,"name":"short part name","eids":["e3","e4"]}]}`;

export async function segment({ svg, elements, regions }) {
  const prompt = `SVG:\n${svg}\n\nELEMENTS:\n${elements
    .map((e) => `${e.eid} <${e.tag}> fill=${e.fill || 'none'} bbox=(${e.bbox.map((v) => Math.round(v)).join(',')})`)
    .join('\n')}\n\nREGIONS (x,y,w,h in viewBox units):\n${regions
    .map((r, i) => `${i}: (${[r.x, r.y, r.w, r.h].map(Math.round).join(',')})`)
    .join('\n')}`;
  const raw = await callModel({ system: SEGMENT_SYSTEM, prompt, model: ROLE_MODEL.model_3 });
  const json = parseJsonLoose(raw);
  const valid = new Set(elements.map((e) => e.eid));
  const masks = (json.masks || []).map((m, i) => ({
    region: Number.isInteger(m.region) ? m.region : i,
    name: String(m.name || `part ${i + 1}`).slice(0, 40),
    eids: (m.eids || []).map(String).filter((id) => valid.has(id)),
  }));
  if (!masks.length) throw new Error('Segmenter returned no masks');
  return masks;
}

// ---- Process 5: [model_4 generate]~  fragments -> fragment_descriptions
const DESCRIBE_SYSTEM = `ROLE: DESCRIBE. You describe cut-out parts (fragments) of an SVG glyph illustration.
For each fragment give one short sentence describing its shape, colour and what object part it depicts, and which
data attribute it is mapped to. Output ONLY JSON: {"descriptions":["...","..."]} in the same order as the input.`;

export async function describeFragments({ glyphSvg, fragments }) {
  const prompt = `FULL GLYPH:\n${glyphSvg}\n\n${fragments
    .map((f, i) => `FRAGMENT ${i} (part "${f.name}", mapped to attribute "${f.attribute}"):\n${f.svg}`)
    .join('\n\n')}`;
  const raw = await callModel({ system: DESCRIBE_SYSTEM, prompt, model: ROLE_MODEL.model_4 });
  const json = parseJsonLoose(raw);
  const d = (json.descriptions || []).map(String);
  if (d.length !== fragments.length) throw new Error('Describer returned the wrong number of descriptions');
  return d;
}

// ---- Process 5: [model_5 generate]~  encoding_prompt -> categorical fragment
const VARIANT_SYSTEM = `ROLE: VARIANT. You redraw one cut-out part of an SVG glyph so that it visually encodes a
categorical data value. You receive the original fragment SVG and an instruction.
Rules:
- Output ONLY one <svg> element that uses EXACTLY the same viewBox as the original fragment. No explanation.
- Keep the same overall position, footprint and size so it still fits into the glyph at the same place.
- Make the variant clearly distinguishable from the variants for the other category values (colour, pattern, shape detail).
- Use only path, circle, ellipse, rect, polygon, polyline, line, g and gradients. No text, images or scripts.`;

export async function generateVariant({ fragmentSvg, viewBox, prompt }) {
  const raw = await callModel({
    system: VARIANT_SYSTEM,
    prompt: `ORIGINAL FRAGMENT (viewBox="${viewBox}"):\n${fragmentSvg}\n\nINSTRUCTION:\n${prompt}`,
    model: ROLE_MODEL.model_5,
  });
  const svg = sanitizeSvg(extractSvg(raw), { viewBox });
  if (!/<(path|circle|ellipse|rect|polygon|polyline|line)\b/i.test(svg)) throw new Error('Variant contains no shapes');
  return svg;
}
