// Model operations. One prompt per operation, built only from the representations in the
// state that precedes it in design.json.
import { callModel, type ModelRole } from "./provider.ts";
import { confineEditToRegions, InvalidOutput, parseJsonObject, validateSvg } from "./svg.ts";
import type { ItemRecord, Point } from "../src/shared/types.ts";

const W = 800, H = 600;

const MODEL_1_SYSTEM = `You are model_1, an image model. You produce images as standalone SVG documents.
Rules: output ONLY the SVG document, starting with <svg and ending with </svg>, no prose, no markdown fences.
Use only static SVG (shapes, paths, gradients, patterns, filters). No <script>, no <foreignObject>, no external references, no <image> elements, no text unless explicitly asked.
Aim for a rich, finished illustration: layered shapes, gradients, light and shadow. Keep the file under ~60 KB.`;

const MODEL_2_SYSTEM = `You are model_2, a text model that writes concise visual descriptions for an image model.
Output ONLY a JSON object, no prose, no markdown fences.`;

/** Run a generative step, validating the output and retrying once when it is invalid. */
async function generateValidated<T>(role: ModelRole, system: string, prompt: string, validate: (t: string) => T): Promise<T> {
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const p = attempt === 0 ? prompt : `${prompt}\n\nYour previous answer was rejected (${lastErr?.message}). Follow the output rules exactly.`;
    const res = await callModel({ role, system, prompt: p });
    try {
      return validate(res.text);
    } catch (e) {
      if (!(e instanceof InvalidOutput)) throw e;
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("generation failed");
}

// P1.9  (r6_1: artifact visual) -> [model_1 generate]~ -> (r7_1: artifact visual)
export function model1GenerateFromRender(render: string): Promise<string> {
  const prompt = `Below is a simple perspective render (SVG) of a 3D block-out scene: shaded boxes stand on a ground plane under a sky, seen from a chosen camera.
Turn it into a finished, detailed illustration of the same scene. Keep the camera, composition, perspective and the position, size and silhouette of every block exactly; interpret blocks as buildings (low blocks as houses or pavilions, tall blocks as towers), the ground as streets, plazas, grass, and add a believable sky, materials, windows, shadows and small details.
Output an SVG with viewBox="0 0 ${W} ${H}" width="${W}" height="${H}", filling the whole frame.

RENDER:
${render}`;
  return generateValidated("model_1", MODEL_1_SYSTEM, prompt, validateSvg);
}

// P1.13 (r7_1 + r9_1* + r10_1*) -> [model_1 modify]~ -> (r7_2)
export async function model1Modify(image: string, selections: { index: number; polygon: Point[] }[], instructions: string[]): Promise<{ edited: string; raw: string }> {
  const regions = selections.map((s) => `Region ${s.index} polygon: ${s.polygon.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).join(" ")}`).join("\n");
  const prompt = `Edit the image below. Change ONLY what lies inside the listed regions (coordinates are in the image's viewBox), following each region's instruction. Everything outside the regions must stay as it is. Return the complete edited SVG with the same viewBox.

REGIONS:
${regions}

INSTRUCTIONS:
${instructions.join("\n")}

IMAGE:
${image}`;
  const raw = await generateValidated("model_1", MODEL_1_SYSTEM, prompt, validateSvg);
  // Enforce the selection constraint in code: outside the regions the original is kept.
  return { edited: confineEditToRegions(image, raw, selections.map((s) => s.polygon)), raw };
}

// P2.4  (r13_1: artifact visual) + (r14_1: instruction language) -> [model_1 generate]~ -> (r15_1)
export function model1GenerateFromSketch(sketch: string, description: string): Promise<string> {
  const prompt = `Below is a user's sketch (as SVG) and a description of what the sketch contains.
Interpret the sketch as a drawing of real things and produce a finished, colourful illustration of it. Keep the layout: every element must stay where it was drawn, at roughly the same size and shape. Use the stroke colours as hints for the colours of the objects.
Output an SVG with viewBox="0 0 ${W} ${H}" width="${W}" height="${H}", filling the whole frame.

DESCRIPTION:
${description}

SKETCH:
${sketch}`;
  return generateValidated("model_1", MODEL_1_SYSTEM, prompt, validateSvg);
}

// P3.6  (r16_1 + r21_1*) -> [model_2 generate]~ -> (r22_1: artifact language)*
export function model2Describe(globalPrompt: string, record: ItemRecord): Promise<string> {
  const prompt = `A picture is being assembled from separately generated items. Overall scene: "${globalPrompt || "(no overall prompt)"}".
Write the visual description for ONE item, using this record:
${JSON.stringify(record, null, 2)}
The item must be a "${record.label}". It will be drawn alone (no background) and placed in the ${record.position} of the picture, in a box ${record.region.w}x${record.region.h} pixels. Fit it to the overall scene's style, mood and time of day. 1–3 sentences covering appearance, colours, pose or orientation.
Return {"description": "..."}`;
  return generateValidated("model_2", MODEL_2_SYSTEM, prompt, (t) => {
    const j = parseJsonObject(t);
    const d = j.description;
    if (typeof d !== "string" || d.trim().length < 10) throw new InvalidOutput("missing description field");
    if (d.length > 800) throw new InvalidOutput("description too long");
    return d.trim();
  });
}

// P3.7  (r21_1* + r22_1*) -> [model_1 generate]~ -> (r23_1: artifact visual)*
export function model1GenerateItem(record: ItemRecord, description: string): Promise<string> {
  const { w, h } = record.region;
  const prompt = `Draw a single ${record.label}, isolated, as an SVG.
Description: ${description}
Requirements: viewBox="0 0 ${w} ${h}" (aspect ratio of the slot it will be placed in); transparent background — no full-frame background rectangle, no ground, no sky; the ${record.label} should fill most of the viewBox.`;
  return generateValidated("model_1", MODEL_1_SYSTEM, prompt, (t) => {
    const svg = validateSvg(t);
    // Enforce "drawn alone": strip a full-frame opaque background rectangle if the model added one.
    const bg = new RegExp(`<rect\\b[^>]*width="(100%|${w})"[^>]*height="(100%|${h})"[^>]*fill="(?!none)[^"]+"[^>]*/>`, "i");
    return svg.replace(bg, "");
  });
}
