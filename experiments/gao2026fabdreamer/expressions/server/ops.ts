// One function (one prompt) per model operation in the design. Each takes only the representations
// present in the state that precedes it.
import { z } from 'zod';
import { callModel } from './model.ts';
import type {
  ConstraintIssue,
  DetectionPrompt,
  FixCall,
  FixOption,
  LayerItem,
  LayerPlan,
  MaterialSettings,
  Occlusion,
  PlannedLayer,
} from '../shared/types.ts';

const svgOut = z.object({ svg: z.string().min(40).describe('complete SVG document, viewBox 0 0 512 512') });
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

// ======================= model_2 (image generator / editor) =======================

const STYLES = [
  'bold flat shapes with a limited palette of 5-7 colours',
  'paper-cut look with layered silhouettes receding into depth',
  'minimal geometric shapes, strong foreground/background separation',
];

/** P1 [model_2 generate]~ prompt → image_candidates* (one call per candidate, varied style hint) */
export async function generateImage(prompt: string, variant: number): Promise<string> {
  const r = await callModel('model_2', {
    op: 'generate image_candidate',
    schema: svgOut,
    prompt: `Create an illustration for this request:\n"""${prompt}"""\n\nThe illustration will later be cut into physical depth layers (background, middle ground, foreground), so compose it as a scene with clear depth and separate, well-defined objects. Style hint for this variant: ${STYLES[variant % STYLES.length]}. Draw background shapes first and foreground shapes last. Fill the full 512×512 frame.`,
  });
  return r.svg;
}

/** P2 [model_2 modify]~ source_image + image_update → source_image_2 */
export async function modifyImage(svg: string, update: string): Promise<string> {
  const r = await callModel('model_2', {
    op: 'modify source_image',
    schema: svgOut,
    prompt: `Here is the current illustration (SVG):\n\n${svg}\n\nApply this change:\n"""${update}"""\n\nReturn the full updated SVG. Keep everything that the change does not concern identical (same ids, shapes and colours).`,
  });
  return r.svg;
}

/** P4 [model_2 modify]~ work_image + fill_prompt → work_image (front items removed, area behind filled) */
export async function inpaintWorkImage(svg: string, removeIds: string[], removedNames: string[], fillPrompt: string, style: string): Promise<string> {
  const r = await callModel('model_2', {
    op: 'modify work_image (remove + fill)',
    schema: svgOut,
    prompt: `Work image (SVG):\n\n${svg}\n\nRemove these objects: ${removedNames.join(', ')} (shape ids: ${removeIds.join(', ') || 'none given'}).\nThen fill the area they covered so the scene behind them looks complete, following these fill instructions:\n"""${fillPrompt}"""\nStyle: ${style}\n\nKeep the ids of all shapes you keep unchanged; give new shapes new ids. Do not leave holes. Return the full SVG.`,
  });
  return r.svg;
}

/** P5 [model_2 generate]~ → isolated_elements*: one element alone on a plain white background, same position. */
export async function generateIsolatedElement(svg: string, item: { name: string; description: string }, style: string): Promise<string> {
  const r = await callModel('model_2', {
    op: 'generate isolated_element',
    schema: svgOut,
    prompt: `Here is a scene (SVG):\n\n${svg}\n\nRedraw ONLY the object "${item.name}" (${item.description}) as a complete, unoccluded shape at exactly the same position and size it has in the scene, on a plain pure-white (#ffffff) background rect covering 0 0 512 512. Nothing else may appear. Style: ${style}. Do not use white inside the object.`,
  });
  return r.svg;
}

/** P6 [model_2 generate]~ grab_request → grab_candidates* */
export async function generateGrabCandidate(request: string, variant: number): Promise<string> {
  const r = await callModel('model_2', {
    op: 'generate grab_candidate',
    schema: svgOut,
    prompt: `Draw this single element for a layered papercut scene:\n"""${request}"""\nVariant ${variant + 1}: ${STYLES[variant % STYLES.length]}. Show it in a natural setting or context (it may touch other things), but make the element itself clearly the subject.`,
  });
  return r.svg;
}

/** P6 [model_2 generate]~ grab_image + occlusion → isolated_grab */
export async function generateIsolatedGrab(svg: string, occlusion: Occlusion, reason: string): Promise<string> {
  const r = await callModel('model_2', {
    op: 'generate isolated_grab',
    schema: svgOut,
    prompt: `Here is an image (SVG) whose main subject should become a standalone cut-out piece:\n\n${svg}\n\nAssessment of the subject: ${occlusion}${reason ? ' — ' + reason : ''}.\nRedraw ONLY the main subject, complete (reconstruct any hidden or cropped parts), centred, filling about 70% of the frame, on a plain pure-white (#ffffff) background rect covering 0 0 512 512. No other objects, no ground shadow, no white inside the subject.`,
  });
  return r.svg;
}

/** P8 [model_2 modify]~ element_crop + repair_target → repaired_element */
export async function repairElement(cropSvg: string, label: string): Promise<string> {
  const r = await callModel('model_2', {
    op: 'modify element_crop → repaired_element',
    schema: svgOut,
    prompt: `This SVG is a crop of an illustration, framed on the object "${label}" (its viewBox is the crop).\n\n${cropSvg}\n\nProduce a clean, complete version of just "${label}" as a single solid cut-out silhouette: reconstruct parts hidden by other objects, close gaps, smooth ragged edges, remove fragments of other objects. Keep the SAME viewBox as the crop so the object stays at the same position and scale. Use a plain pure-white (#ffffff) background rect covering the whole viewBox and draw the object in one dark colour.`,
  });
  return r.svg;
}

// ======================= model_1 (vision-language analyst) =======================

const plannedLayer = z.object({
  id: z.string().describe('short slug like "sky" or "foreground_trees"'),
  name: z.string(),
  description: z.string(),
  depth: z.number().int().min(0).describe('0 = back-most'),
  elements: z.array(z.string()).describe('human-readable names of the objects in this layer (not SVG ids)'),
});
const layerPlanOut = z.object({ layers: z.array(plannedLayer).min(2).max(10), rationale: z.string() });

function normalizePlan(p: { layers: PlannedLayer[]; rationale: string }, change?: string): LayerPlan {
  const seen = new Set<string>();
  const layers = [...p.layers]
    .sort((a, b) => a.depth - b.depth)
    .map((l, i) => {
      let id = l.id.toLowerCase().replace(/[^a-z0-9_]+/g, '_') || `layer_${i}`;
      while (seen.has(id)) id += '_b';
      seen.add(id);
      return { ...l, id, depth: i };
    });
  return { layers, rationale: p.rationale, change };
}

/** P3 [model_1 generate]~ source_image → layer_plan */
export async function generateLayerPlan(svg: string, png: string): Promise<LayerPlan> {
  const r = await callModel('model_1', {
    op: 'generate layer_plan',
    schema: layerPlanOut,
    images: [{ name: 'source_image', png }],
    prompt: `The image (also given as SVG below) will be built as a physical layered papercut / shadow box: each depth layer is cut from its own sheet and the sheets are stacked with spacers.\nPropose a layer plan of 3-6 depth layers from back (depth 0, usually sky/backdrop) to front. Put each visible object in exactly one layer, grouping objects at similar depth. Name objects so they can be found in the image.\n\nSVG:\n${svg}`,
  });
  return normalizePlan(r);
}

/** P3 [model_1 modify]~ source_image + layer_plan + layer_change → layer_plan */
export async function modifyLayerPlan(svg: string, png: string, plan: LayerPlan, change: string): Promise<LayerPlan> {
  const r = await callModel('model_1', {
    op: 'modify layer_plan',
    schema: layerPlanOut,
    images: [{ name: 'source_image', png }],
    prompt: `Current layer plan (back to front):\n${JSON.stringify(plan.layers, null, 1)}\n\nRevise it according to this request:\n"""${change}"""\nKeep layer ids that still make sense. Each object belongs to exactly one layer.\n\nSVG of the image:\n${svg}`,
  });
  return normalizePlan(r, change);
}

/** P4 [model_1 extract] source_image + confirmed_layers → layer_items* */
export async function extractLayerItems(svg: string, png: string, layers: PlannedLayer[]): Promise<LayerItem[]> {
  const r = await callModel('model_1', {
    op: 'extract layer_items',
    schema: z.object({
      items: z.array(z.object({ id: z.string(), layerId: z.string(), name: z.string(), description: z.string().describe('appearance and location in the image'), color: hex })),
    }),
    images: [{ name: 'source_image', png }],
    prompt: `Confirmed layers (back to front):\n${JSON.stringify(layers.map((l) => ({ id: l.id, name: l.name, elements: l.elements })), null, 1)}\n\nList the concrete, separately cuttable items visible in the image for each confirmed layer (layerId must be one of: ${layers.map((l) => l.id).join(', ')}). Give each a unique slug id, a description with its location, and its main colour as #rrggbb. Merge tiny details into the item they sit on. Do not list items for layers that are not confirmed.\n\nSVG:\n${svg}`,
  });
  const valid = new Set(layers.map((l) => l.id));
  const seen = new Set<string>();
  return r.items
    .filter((i) => valid.has(i.layerId))
    .map((i) => {
      let id = i.id.toLowerCase().replace(/[^a-z0-9_]+/g, '_');
      while (seen.has(id)) id += '_b';
      seen.add(id);
      return { ...i, id, color: i.color.toLowerCase() };
    });
}

/** P4 [model_1 extract] source_image + layer_items → style */
export async function extractStyle(svg: string, png: string, items: LayerItem[]): Promise<string> {
  const r = await callModel('model_1', {
    op: 'extract style',
    schema: z.object({ style: z.string().describe('2-4 sentences') }),
    images: [{ name: 'source_image', png }],
    prompt: `Describe the visual style of this image so another artist could paint missing parts consistently: palette (with hex colours), shape language, level of detail, how depth is shown. The image contains: ${items.map((i) => i.name).join(', ')}.\n\nSVG:\n${svg}`,
  });
  return r.style;
}

/** P4 [model_1 extract] work_image + layer_items + style + segments → detection_prompts* */
export async function extractDetectionPrompts(workSvg: string, items: LayerItem[], style: string): Promise<DetectionPrompt[]> {
  const r = await callModel('model_1', {
    op: 'extract detection_prompts',
    schema: z.object({ prompts: z.array(z.object({ itemId: z.string(), label: z.string(), prompt: z.string() })) }),
    prompt: `We need to segment these items from the image below (one detection prompt per item):\n${JSON.stringify(items.map((i) => ({ itemId: i.id, name: i.name, description: i.description, color: i.color })), null, 1)}\n\nWrite for each item a short, unambiguous referring expression that a segmentation model can use to find exactly that object (mention colour, shape and position). Style for reference: ${style}\n\nImage SVG:\n${workSvg}`,
  });
  const byId = new Map(items.map((i) => [i.id, i]));
  const out = r.prompts.filter((p) => byId.has(p.itemId));
  for (const i of items) if (!out.some((p) => p.itemId === i.id)) out.push({ itemId: i.id, label: i.name, prompt: `${i.name}: ${i.description}` });
  return out;
}

/** P4 [model_1 generate]~ work_image + layer_items + style + segments_2 → fill_prompt */
export async function generateFillPrompt(workSvg: string, removed: LayerItem[], remaining: LayerItem[], style: string): Promise<string> {
  const r = await callModel('model_1', {
    op: 'generate fill_prompt',
    schema: z.object({ fill_prompt: z.string() }),
    prompt: `These objects are being cut out of the image as their own layer and will be removed from it: ${removed.map((i) => `${i.name} (${i.description})`).join('; ')}.\nObjects that stay behind: ${remaining.map((i) => i.name).join(', ') || 'only the backdrop'}.\nWrite an instruction for an image editor describing what should be painted in the uncovered area so the remaining scene looks complete (e.g. continue the hill line, extend the sky gradient). Style: ${style}\n\nImage SVG:\n${workSvg}`,
  });
  return r.fill_prompt;
}

/** P6 [model_1 evaluate] grab_image → occlusion */
export async function evaluateOcclusion(png: string): Promise<{ occlusion: Occlusion; reason: string }> {
  return callModel('model_1', {
    op: 'evaluate occlusion',
    schema: z.object({ occlusion: z.enum(['complete', 'occluded', 'cropped']), reason: z.string() }),
    images: [{ name: 'grab_image', png }],
    prompt: `Look at the main subject of this image. Is it fully visible ("complete"), partly hidden behind other objects ("occluded"), or cut off by the image border ("cropped")? Give a one-sentence reason.`,
  });
}

/** P9 [model_1 extract] canvas + split_target + split_request → part_prompts* */
export async function extractPartPrompts(png: string, label: string, request: string): Promise<DetectionPrompt[]> {
  const r = await callModel('model_1', {
    op: 'extract part_prompts',
    schema: z.object({ parts: z.array(z.object({ name: z.string(), prompt: z.string() })).min(2).max(8) }),
    images: [{ name: 'split_target', png }],
    prompt: `The image shows the cut-out piece "${label}" (a solid silhouette). The user wants to split it:\n"""${request}"""\nList the parts it should be split into, each with a referring expression describing where that part lies within the silhouette (top/bottom/left/right, shape).`,
  });
  return r.parts.map((p, i) => ({ itemId: `part_${i + 1}`, label: p.name, prompt: p.prompt }));
}

// ======================= model_3 (promptable segmenter) =======================

const segOut = z.object({
  results: z.array(
    z.object({
      itemId: z.string(),
      elementIds: z.array(z.string()).describe('ids of SVG shapes or groups that make up the object'),
      polygons: z.array(z.array(z.array(z.number()).length(2))).describe('optional polygons [[x,y],...] in 512×512 pixel coordinates'),
    }),
  ),
});
export type SegResult = z.infer<typeof segOut>['results'][number];

/** P4/P9 [model_3 extract] and P5 [model_3 modify]: prompts → masks (as element ids and/or polygons) */
export async function segment(args: {
  op: string;
  png: string;
  svg?: string;
  prompts: DetectionPrompt[];
  feedback?: string;
  polygonsOnly?: boolean;
}): Promise<SegResult[]> {
  const r = await callModel('model_3', {
    op: args.op,
    schema: segOut,
    images: [{ name: 'image', png: args.png }],
    prompt:
      `Prompts:\n${args.prompts.map((p) => `- itemId "${p.itemId}": ${p.prompt}`).join('\n')}\n\n` +
      (args.polygonsOnly
        ? 'Return for each prompt one or more polygons (pixel coordinates in the 512×512 image) that outline the region. Leave elementIds empty. Regions for different prompts should not overlap and together should cover the shown silhouette.'
        : `The image's SVG source is below; every shape has an id. Return for each prompt the ids of all shapes (or groups) that form that object. Only if no shapes match, give polygons instead.\n\nSVG:\n${args.svg}`) +
      (args.feedback ? `\n\nA previous segmentation had these quality problems; fix them:\n${args.feedback}` : ''),
  });
  return r.results;
}

// ======================= model_4 (fabrication advisor) =======================

/** P10 [model_4 generate]~ canvas + material_settings + constraint_issues → constraint_report */
export async function generateConstraintReport(issues: ConstraintIssue[], settings: MaterialSettings, canvasSummary: string): Promise<string> {
  const r = await callModel('model_4', {
    op: 'generate constraint_report',
    schema: z.object({ report: z.string().describe('markdown-free plain text, short paragraphs') }),
    prompt: `Material settings: ${JSON.stringify(settings)}\nCanvas: ${canvasSummary}\nDetected constraint issues:\n${JSON.stringify(issues.map(({ options, ...i }) => ({ ...i, options: options.map((o) => o.label) })), null, 1)}\n\nWrite a short report for the maker: what each problem means physically for this material, which issues matter most, and which resolution option you recommend for each. If there are no issues, say the design is ready to cut.`,
  });
  return r.report;
}

/** P10 [model_4 translate] resolution → fix_call */
export async function translateResolution(issue: ConstraintIssue, option: FixOption, settings: MaterialSettings, canvasSummary: string): Promise<FixCall> {
  const r = await callModel('model_4', {
    op: 'translate resolution → fix_call',
    schema: z.object({
      tool: z.enum(['thicken', 'removeThinParts', 'removeSmallFragments', 'deleteSegment', 'moveToLayer', 'mergeLayers', 'clipToFrame', 'scaleSegment']),
      args: z.record(z.string(), z.union([z.string(), z.number()])),
      explanation: z.string(),
    }),
    prompt: `Translate the chosen resolution into exactly one tool call.\n\nTools:\n- thicken {segmentId, mm}: grow a piece outward by mm\n- removeThinParts {segmentId, mm}: remove parts narrower than mm\n- removeSmallFragments {segmentId, minAreaMm2}: drop disconnected bits smaller than minAreaMm2 (keeps the largest part)\n- deleteSegment {segmentId}\n- moveToLayer {segmentId, layerId}\n- mergeLayers {sourceLayerId, targetLayerId}: move all pieces of source into target and remove source\n- clipToFrame {segmentId}: cut away whatever lies outside the artwork frame\n- scaleSegment {segmentId, factor}: scale a piece about its centre\n\nMaterial settings: ${JSON.stringify(settings)}\nCanvas: ${canvasSummary}\nIssue: ${JSON.stringify({ ...issue, options: undefined })}\nChosen resolution: "${option.label}" (tool ${option.tool}).\n\nUse tool "${option.tool}" and fill in its arguments with concrete ids and values that resolve the issue.`,
  });
  return r as FixCall;
}
