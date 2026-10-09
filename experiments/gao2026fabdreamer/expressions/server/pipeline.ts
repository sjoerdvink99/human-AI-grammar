// Process 4 (layer decomposition by peeling front→back) with process 5 (mask quality fallback) inside it,
// followed by process 7's first step (tool_2 compose).
import type { DetectionPrompt, LayerItem, MaskQuality, PlannedLayer, StoredSegment, ImageArtifact } from '../shared/types.ts';
import * as ops from './ops.ts';
import { area, components, emptyMask, maskToSegment, polygonsToMask, union, W, H, type Mask } from './mask.ts';
import { dominantColor, fillOfIds, foregroundMask, listShapeIds, meanColor, removeIds, renderIdMask, toImageArtifact } from './svg.ts';
import { commitCanvas, composeCanvas, currentPlan, currentSource, state, type JobCtx } from './store.ts';
import { newId } from './util.ts';

/** tool_1 translate (model_3 output → mask): rasterize the selected shapes and polygons. */
export function resultToMask(svg: string | undefined, r: ops.SegResult): Mask {
  let m = emptyMask();
  if (svg && r.elementIds.length) {
    const known = new Set(listShapeIds(svg));
    const ids = r.elementIds.filter((id) => known.has(id));
    if (ids.length) m = renderIdMask(svg, ids);
  }
  const polys = r.polygons.filter((p) => p.length >= 3) as [number, number][][];
  if (polys.length) m = union(m, polygonsToMask(polys));
  return m;
}

/** P5 [tool_1 evaluate] masks → mask_quality */
export function evaluateMask(m: Mask, p: DetectionPrompt, allowFull = false): MaskQuality {
  const a = area(m);
  const { sizes } = components(m);
  const comps = sizes.length - 1;
  const largest = Math.max(0, ...sizes.slice(1));
  const q: MaskQuality = { itemId: p.itemId, label: p.label, areaFraction: a / (W * H), components: comps, largestComponentShare: a ? largest / a : 0, ok: true, reasons: [] };
  if (a === 0) q.reasons.push('empty mask: nothing was found');
  else if (q.areaFraction < 0.0005) q.reasons.push('mask is tiny (<0.05% of image)');
  if (!allowFull && q.areaFraction > 0.92) q.reasons.push('mask covers almost the whole image');
  if (comps > 12 && q.largestComponentShare < 0.3) q.reasons.push(`mask is fragmented into ${comps} pieces`);
  q.ok = q.reasons.length === 0;
  return q;
}

/** Process 5: check masks; refine with model_3; fall back to model_2 isolation + tool extraction. */
export async function ensureMaskQuality(
  ctx: JobCtx,
  work: ImageArtifact,
  prompts: DetectionPrompt[],
  masks: Map<string, Mask>,
  items: Map<string, LayerItem>,
  style: string,
  allowFull = false,
): Promise<{ masks: Map<string, Mask>; quality: MaskQuality[]; fallbackUsed: string[]; refined: string[] }> {
  const quality1 = await ctx.step('P5 [tool_1 evaluate] masks → mask_quality_1', () => prompts.map((p) => evaluateMask(masks.get(p.itemId)!, p, allowFull)), (q) => `${q.filter((x) => !x.ok).length} of ${q.length} masks need work`);
  const bad1 = quality1.filter((q) => !q.ok);
  if (!bad1.length) return { masks, quality: quality1, fallbackUsed: [], refined: [] };

  const badPrompts = prompts.filter((p) => bad1.some((b) => b.itemId === p.itemId));
  const refinedRes = await ctx.step('P5 [model_3 modify] → refined_masks_1', () =>
    ops.segment({ op: 'modify masks → refined_masks', png: work.png, svg: work.svg, prompts: badPrompts, feedback: bad1.map((b) => `${b.itemId}: ${b.reasons.join('; ')}`).join('\n') }),
  );
  const refined: string[] = [];
  for (const r of refinedRes) {
    if (!badPrompts.some((p) => p.itemId === r.itemId)) continue;
    masks.set(r.itemId, resultToMask(work.svg, r));
    refined.push(r.itemId);
  }
  const quality2 = await ctx.step('P5 [tool_1 evaluate] refined_masks → mask_quality_2', () => badPrompts.map((p) => evaluateMask(masks.get(p.itemId)!, p, allowFull)), (q) => `${q.filter((x) => !x.ok).length} still failing`);
  const bad2 = quality2.filter((q) => !q.ok);
  const fallbackUsed: string[] = [];
  if (bad2.length) {
    const isolated = await ctx.step(`P5 [model_2 generate]~ → isolated_elements_1 (${bad2.length})`, () =>
      Promise.all(
        bad2.map(async (b) => {
          const it = items.get(b.itemId);
          try {
            return { id: b.itemId, img: toImageArtifact(await ops.generateIsolatedElement(work.svg, { name: it?.name ?? b.label, description: it?.description ?? '' }, style), 'isolated ' + b.label) };
          } catch {
            return { id: b.itemId, img: undefined };
          }
        }),
      ),
    );
    await ctx.step('P5 [tool_1 extract] → fallback_masks_1', () => {
      for (const { id, img } of isolated) {
        if (!img) continue;
        const fm = foregroundMask(img.svg);
        if (area(fm) > 0) {
          masks.set(id, fm);
          fallbackUsed.push(id);
        }
      }
      return fallbackUsed;
    }, (f) => `fallback masks for: ${f.join(', ') || 'none'}`);
  }
  const quality = quality1.map((q) => (refined.includes(q.itemId) || fallbackUsed.includes(q.itemId) ? evaluateMask(masks.get(q.itemId)!, prompts.find((p) => p.itemId === q.itemId)!, allowFull) : q));
  return { masks, quality, fallbackUsed, refined };
}

/** Process 4. Triggered when the user confirms layers. */
export async function runLayerPipeline(ctx: JobCtx, confirmedIds: string[]) {
  const source = currentSource();
  const plan = currentPlan();
  if (!source || !plan) throw new Error('Need a source image and a layer plan first');
  const confirmed: PlannedLayer[] = plan.layers.filter((l) => confirmedIds.includes(l.id)).sort((a, b) => a.depth - b.depth);
  if (confirmed.length < 1) throw new Error('Select at least one layer');
  state.confirmedLayers = { layerIds: confirmed.map((l) => l.id) };
  ctx.note('P4 [human select] layer_plan → confirmed_layers_1', confirmed.map((l) => l.name).join(', '));

  const items = await ctx.step('P4 [model_1 extract] → layer_items_1', () => ops.extractLayerItems(source.svg, source.png, confirmed), (r) => `${r.length} items`);
  state.layerItems = items;
  const style = await ctx.step('P4 [model_1 extract] → style_1', () => ops.extractStyle(source.svg, source.png, items), (s) => s.slice(0, 160));
  state.style = style;

  // tool_1 modify: normalized working copy of the source image; empty segment collection
  let work = await ctx.step('P4 [tool_1 modify] → work_image_1 + segments_1', () => toImageArtifact(source.svg, 'work image (initial)'));
  state.workImages = [work];
  state.rounds = [];
  const segments: StoredSegment[] = [];
  const itemMap = new Map(items.map((i) => [i.id, i]));

  // Loop: peel layers front → back
  const frontToBack = [...confirmed].reverse();
  for (let li = 0; li < frontToBack.length; li++) {
    const layer = frontToBack[li];
    const isBack = li === frontToBack.length - 1;
    const layerItems = items.filter((i) => i.layerId === layer.id);
    const round = { layerId: layer.id, layerName: layer.name, detectionPrompts: [] as DetectionPrompt[], maskQuality: [] as MaskQuality[], fallbackUsed: [] as string[], workImageBefore: work.id, segmentIds: [] as string[] } as (typeof state.rounds)[number];
    state.rounds.push(round);
    ctx.note(`— layer "${layer.name}" (${layerItems.length} items)`, undefined, 'done');

    let removedIds: string[] = [];
    if (layerItems.length) {
      const prompts = await ctx.step(`P4 [model_1 extract] → detection_prompts_1 (${layer.name})`, () => ops.extractDetectionPrompts(work.svg, layerItems, style), (p) => p.map((x) => x.label).join(', '));
      round.detectionPrompts = prompts;
      const results = await ctx.step(`P4 [model_3 extract] → masks_1 (${layer.name})`, () => ops.segment({ op: 'extract masks', png: work.png, svg: work.svg, prompts }));
      const masks = new Map<string, Mask>();
      for (const p of prompts) {
        const r = results.find((x) => x.itemId === p.itemId);
        masks.set(p.itemId, r ? resultToMask(work.svg, r) : emptyMask());
        if (r) removedIds.push(...r.elementIds);
      }
      const q = await ensureMaskQuality(ctx, work, prompts, masks, itemMap, style, isBack);
      round.maskQuality = q.quality;
      round.fallbackUsed = q.fallbackUsed;

      const newSegs = await ctx.step(`P4 [tool_1 translate] masks → segments_2 (${layer.name})`, () => {
        const out: StoredSegment[] = [];
        for (const p of prompts) {
          const m = q.masks.get(p.itemId)!;
          if (!area(m)) continue;
          const item = itemMap.get(p.itemId);
          const seg = maskToSegment(m, {
            id: newId('seg'),
            label: item?.name ?? p.label,
            itemId: p.itemId,
            layerId: layer.id,
            color: q.fallbackUsed.includes(p.itemId)
              ? item?.color ?? '#888888'
              : fillOfIds(work.svg, results.find((x) => x.itemId === p.itemId)?.elementIds ?? []) ?? meanColor(work.svg, m),
            source: q.fallbackUsed.includes(p.itemId) ? 'fallback' : q.refined.includes(p.itemId) ? 'refined' : 'detected',
          });
          if (seg) out.push(seg);
        }
        return out;
      }, (s) => `${s.length} segments`);
      segments.push(...newSegs);
      round.segmentIds = newSegs.map((s) => s.id);
    }

    if (isBack) {
      // backboard for the back-most sheet, unless a back-layer item already covers the frame
      const full = segments.find((s) => round.segmentIds.includes(s.id) && s.area > 0.9 * W * H);
      if (full) full.source = 'background';
      const covered = !!full;
      const board = covered ? null : maskToSegment(new Uint8Array(W * H).fill(1), { id: newId('seg'), label: `${layer.name} backboard`, layerId: layer.id, color: dominantColor(work.svg), source: 'background' });
      if (board) {
        segments.unshift(board);
        round.segmentIds.unshift(board.id);
      }
      break; // nothing behind the back layer to reveal: loop ends
    }

    if (layerItems.length) {
      const remaining = items.filter((i) => frontToBack.slice(li + 1).some((l) => l.id === i.layerId));
      const fill = await ctx.step(`P4 [model_1 generate]~ → fill_prompt_1 (${layer.name})`, () => ops.generateFillPrompt(work.svg, layerItems, remaining, style), (f) => f.slice(0, 160));
      round.fillPrompt = fill;
      const before = work;
      work = await ctx.step(`P4 [model_2 modify]~ work_image + fill_prompt → work_image (${layer.name} removed)`, async () => {
        const svg = await ops.inpaintWorkImage(before.svg, removedIds, layerItems.map((i) => i.name), fill, style);
        // enforce: shapes that formed removed items must be gone
        return toImageArtifact(removeIds(svg, removedIds), `work image without ${layer.name}`);
      });
      state.workImages.push(work);
      round.workImageAfter = work.id;
    }
  }

  state.segments = segments;
  // Process 7 starts from segments_1: tool_2 compose
  await ctx.step('P7 [tool_2 compose] segments_1* → canvas_1', () => {
    state.canvasHistory = [];
    commitCanvas(composeCanvas(segments), 'composed from layers');
    return state.canvas!;
  }, (c) => `${c.layers.length} layers, ${c.segments.length} pieces`);
}
